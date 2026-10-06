import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, lte, or } from 'drizzle-orm';
import type { Database } from '../../shared/db/client';
import { vvAdminOutbox, vvAdminOutboxAttempts } from '../../shared/db/schema';
import type { VvAdminOrderEvent } from './integration.service';
import { signVvAdminWebhook } from './vv-admin-signature';

type OutboxTransaction = Pick<Database, 'insert' | 'select'>;
type DispatchDatabase = Pick<Database, 'transaction'>;

const DISPATCH_LEASE_MS = 5 * 60 * 1_000;
const DISPATCH_LEASE_SAFETY_MS = 30 * 1_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 1_000;

export type VvAdminDispatchConfig = {
  url: string;
  siteKey: string;
  secret: string;
  secretVersion: string;
  requestTimeoutMs?: number;
};

export type DispatchDueEventsInput = { limit: number };

export type DispatchDueEventResult = {
  eventId: string;
  status: 'sent' | 'retry_scheduled' | 'dead';
};

export type EnqueueOrderEventInput = {
  eventType: 'order.created' | 'order.payment_reached' | 'order.paid' | 'order.cancelled';
  event: VvAdminOrderEvent;
  order: { id: string };
};

export class VvAdminOutbox {
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly db: DispatchDatabase,
    private readonly config: VvAdminDispatchConfig,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (
      !Number.isFinite(this.requestTimeoutMs)
      || this.requestTimeoutMs <= 0
      || this.requestTimeoutMs >= DISPATCH_LEASE_MS - DISPATCH_LEASE_SAFETY_MS
    ) {
      throw new Error(
        'VV Admin request timeout must be positive and shorter than the dispatch lease',
      );
    }
  }

  static async enqueueOrderEvent(
    tx: OutboxTransaction,
    input: EnqueueOrderEventInput,
  ) {
    const idempotencyKey = `${input.eventType}:order:${input.order.id}`;
    const eventId = randomUUID();
    const [inserted] = await tx
      .insert(vvAdminOutbox)
      .values({
        eventId,
        eventType: input.eventType,
        aggregateType: 'order',
        aggregateId: input.order.id,
        idempotencyKey,
        payload: { ...input.event, eventId },
      })
      .onConflictDoNothing()
      .returning();

    if (inserted) {
      return inserted;
    }

    const [existing] = await tx
      .select()
      .from(vvAdminOutbox)
      .where(eq(vvAdminOutbox.idempotencyKey, idempotencyKey))
      .limit(1);

    if (!existing) {
      throw new Error('VV Admin outbox event could not be enqueued');
    }

    return existing;
  }

  async dispatchDueEvents(
    input: DispatchDueEventsInput,
  ): Promise<DispatchDueEventResult[]> {
    const maximumSequentialClaims = Math.floor(
      (DISPATCH_LEASE_MS - DISPATCH_LEASE_SAFETY_MS) / this.requestTimeoutMs,
    );
    const dueEvents = await this.claimDueEvents(
      Math.min(input.limit, maximumSequentialClaims),
    );
    const results: DispatchDueEventResult[] = [];

    for (const event of dueEvents) {
      results.push(await this.dispatchEvent(event));
    }

    return results;
  }

  private async claimDueEvents(limit: number) {
    const startedAt = this.now();

    return this.db.transaction(async (tx) => {
      const events = await tx
        .select()
        .from(vvAdminOutbox)
        .where(
          or(
            and(
              inArray(vvAdminOutbox.status, ['pending', 'retry']),
              lte(vvAdminOutbox.nextAttemptAt, startedAt),
            ),
            and(
              eq(vvAdminOutbox.status, 'sending'),
              lte(vvAdminOutbox.dispatchLeaseExpiresAt, startedAt),
            ),
          ),
        )
        .orderBy(asc(vvAdminOutbox.nextAttemptAt))
        .limit(limit)
        .for('update', { skipLocked: true });

      return Promise.all(
        events.map(async (event) => {
          if (event.status === 'sending') {
            await tx
              .update(vvAdminOutboxAttempts)
              .set({
                status: 'failed',
                errorMessage: 'VV Admin dispatch lease expired',
                finishedAt: startedAt,
              })
              .where(
                and(
                  eq(vvAdminOutboxAttempts.outboxId, event.id),
                  eq(vvAdminOutboxAttempts.attemptNumber, event.attemptCount),
                  eq(vvAdminOutboxAttempts.status, 'sending'),
                ),
              );
          }
          const attemptNumber = event.attemptCount + 1;
          await tx
            .update(vvAdminOutbox)
            .set({
              status: 'sending',
              attemptCount: attemptNumber,
              dispatchLeaseExpiresAt: new Date(
                startedAt.getTime() + DISPATCH_LEASE_MS,
              ),
              updatedAt: startedAt,
            })
            .where(eq(vvAdminOutbox.id, event.id));
          const [attempt] = await tx
            .insert(vvAdminOutboxAttempts)
            .values({
              outboxId: event.id,
              attemptNumber,
              status: 'sending',
              startedAt,
            })
            .returning();

          return { event: { ...event, attemptCount: attemptNumber }, attemptId: attempt!.id };
        }),
      );
    });
  }

  private async dispatchEvent(claim: Awaited<ReturnType<VvAdminOutbox['claimDueEvents']>>[number]): Promise<DispatchDueEventResult> {
    const timestamp = this.now().toISOString();
    const rawBody = Buffer.from(
      JSON.stringify({
        ...(claim.event.payload as Record<string, unknown>),
        eventId: claim.event.eventId,
      }),
      'utf8',
    );
    const { signature } = signVvAdminWebhook({
      secret: this.config.secret,
      version: this.config.secretVersion,
      timestamp,
      eventId: claim.event.eventId,
      rawBody,
    });

    try {
      const response = await this.fetchFn(this.config.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-vv-site-key': this.config.siteKey,
          'x-vv-signature-version': this.config.secretVersion,
          'x-vv-timestamp': timestamp,
          'x-vv-event-id': claim.event.eventId,
          'x-vv-signature': signature,
        },
        body: rawBody,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });

      if (response.ok) {
        await this.markSent(claim, response.status);
        return { eventId: claim.event.eventId, status: 'sent' };
      }

      if (response.status >= 400 && response.status < 500) {
        await this.markDead(claim, response.status);
        return { eventId: claim.event.eventId, status: 'dead' };
      }

      await this.scheduleRetry(claim, `VV Admin webhook returned ${response.status}`, response.status);
      return { eventId: claim.event.eventId, status: 'retry_scheduled' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'VV Admin webhook request failed';
      await this.scheduleRetry(claim, message);
      return { eventId: claim.event.eventId, status: 'retry_scheduled' };
    }
  }

  private async markSent(claim: Awaited<ReturnType<VvAdminOutbox['claimDueEvents']>>[number], httpStatus: number) {
    const finishedAt = this.now();
    await this.db.transaction(async (tx) => {
      await tx
        .update(vvAdminOutboxAttempts)
        .set({ status: 'sent', httpStatus, finishedAt })
        .where(
          and(
            eq(vvAdminOutboxAttempts.id, claim.attemptId),
            eq(vvAdminOutboxAttempts.status, 'sending'),
          ),
        );
      await tx
        .update(vvAdminOutbox)
        .set({
          status: 'sent',
          sentAt: finishedAt,
          dispatchLeaseExpiresAt: null,
          lastError: null,
          updatedAt: finishedAt,
        })
        .where(
          and(
            eq(vvAdminOutbox.id, claim.event.id),
            eq(vvAdminOutbox.status, 'sending'),
            eq(vvAdminOutbox.attemptCount, claim.event.attemptCount),
          ),
        );
    });
  }

  private async markDead(claim: Awaited<ReturnType<VvAdminOutbox['claimDueEvents']>>[number], httpStatus: number) {
    const finishedAt = this.now();
    await this.db.transaction(async (tx) => {
      await tx
        .update(vvAdminOutboxAttempts)
        .set({ status: 'failed', httpStatus, errorMessage: `VV Admin webhook returned ${httpStatus}`, finishedAt })
        .where(
          and(
            eq(vvAdminOutboxAttempts.id, claim.attemptId),
            eq(vvAdminOutboxAttempts.status, 'sending'),
          ),
        );
      await tx
        .update(vvAdminOutbox)
        .set({
          status: 'dead',
          dispatchLeaseExpiresAt: null,
          lastError: `VV Admin webhook returned ${httpStatus}`,
          updatedAt: finishedAt,
        })
        .where(
          and(
            eq(vvAdminOutbox.id, claim.event.id),
            eq(vvAdminOutbox.status, 'sending'),
            eq(vvAdminOutbox.attemptCount, claim.event.attemptCount),
          ),
        );
    });
  }

  private async scheduleRetry(claim: Awaited<ReturnType<VvAdminOutbox['claimDueEvents']>>[number], errorMessage: string, httpStatus?: number) {
    const finishedAt = this.now();
    const delayMs = 1_000 * 2 ** (claim.event.attemptCount - 1);
    const nextAttemptAt = new Date(finishedAt.getTime() + delayMs);
    await this.db.transaction(async (tx) => {
      await tx
        .update(vvAdminOutboxAttempts)
        .set({ status: 'failed', httpStatus, errorMessage, finishedAt })
        .where(
          and(
            eq(vvAdminOutboxAttempts.id, claim.attemptId),
            eq(vvAdminOutboxAttempts.status, 'sending'),
          ),
        );
      await tx
        .update(vvAdminOutbox)
        .set({
          status: 'retry',
          dispatchLeaseExpiresAt: null,
          nextAttemptAt,
          lastError: errorMessage,
          updatedAt: finishedAt,
        })
        .where(
          and(
            eq(vvAdminOutbox.id, claim.event.id),
            eq(vvAdminOutbox.status, 'sending'),
            eq(vvAdminOutbox.attemptCount, claim.event.attemptCount),
          ),
        );
    });
  }
}
