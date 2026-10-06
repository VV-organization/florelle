import { describe, expect, it, vi } from 'vitest';
import { vvAdminOutbox, vvAdminOutboxAttempts } from '../../../shared/db/schema';
import { buildIntegrationConfig } from '../integration.config';
import { IntegrationService } from '../integration.service';
import { VvAdminOutbox } from '../vv-admin-outbox';
import { signVvAdminWebhook } from '../vv-admin-signature';

describe('VvAdminOutbox', () => {
  it('persists a complete VV Admin schema v2 order envelope', async () => {
    let persisted: Record<string, unknown> | undefined;
    const returning = vi.fn().mockImplementation(async () => [
      { id: 'outbox-1', ...persisted },
    ]);
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockImplementation((input: Record<string, unknown>) => {
      persisted = input;
      return { onConflictDoNothing };
    });
    const insert = vi.fn().mockReturnValue({ values });
    const service = new IntegrationService(
      { execute: vi.fn() },
      { ping: vi.fn() },
      {} as never,
      buildIntegrationConfig({ PUBLIC_FRONTEND_URL: 'https://flower-point.example' }),
    );

    await VvAdminOutbox.enqueueOrderEvent(
      { insert, select: vi.fn() } as never,
      {
        eventType: 'order.paid',
        event: service.buildOrderEvent({
          eventType: 'order.paid',
          occurredAt: new Date('2026-08-14T10:00:00.000Z'),
          source: 'customer',
          order: {
            id: 'order-1',
            merchantOrderId: 'FP-123',
            totalUsd: '42.50',
            createdAt: new Date('2026-08-14T09:59:00.000Z'),
          },
          items: [
            {
              id: 'item-1',
              listingId: 'listing-1',
              quantity: 2,
              unitPriceUsd: '21.25',
              productName: 'Red Rose',
            },
          ],
          payment: {
            status: 'paid',
            provider: 'arcopay',
            paidAt: new Date('2026-08-14T10:00:00.000Z'),
          },
        }),
        order: { id: 'order-1' },
      },
    );

    expect(persisted?.payload).toEqual({
      eventId: expect.any(String),
      schemaVersion: 2,
      eventType: 'order.paid',
      source: 'customer',
      occurredAt: '2026-08-14T10:00:00.000Z',
      site: { domain: 'flower-point.example' },
      subject: { type: 'order', externalId: 'order-1' },
      data: {
        status: 'completed',
        externalOrderId: 'order-1',
        merchantOrderId: 'FP-123',
        totalAmount: '42.50',
        currency: 'USD',
        provider: 'arcopay',
        payment: {
          status: 'paid',
          method: {
            type: 'sbp',
            displayName: 'Arcopay SBP',
            provider: 'arcopay',
          },
          paidAt: '2026-08-14T10:00:00.000Z',
        },
        items: [
          {
            externalItemId: 'item-1',
            listingId: 'listing-1',
            quantity: 2,
            name: 'Red Rose',
            priceAmount: '21.25',
            currency: 'USD',
          },
        ],
        createdAt: '2026-08-14T09:59:00.000Z',
      },
    });
  });

  it('returns the existing row when an order event has already been enqueued', async () => {
    const existingRow = { id: 'outbox-1', eventId: 'event-1' };
    const returning = vi.fn().mockResolvedValue([]);
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    const insert = vi.fn().mockReturnValue({ values });
    const limit = vi.fn().mockResolvedValue([existingRow]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const result = await VvAdminOutbox.enqueueOrderEvent(
      { insert, select } as never,
      {
        eventType: 'order.payment_reached',
        event: {
          schemaVersion: 2,
          eventType: 'order.created',
          occurredAt: '2026-08-14T10:00:00.000Z',
          source: 'customer',
          subject: { type: 'order', externalId: 'order-1' },
          data: { status: 'created', payment: { status: 'pending' } },
        },
        order: { id: 'order-1' },
      },
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'order.payment_reached',
        aggregateType: 'order',
        aggregateId: 'order-1',
        idempotencyKey: 'order.payment_reached:order:order-1',
      }),
    );
    const persisted = values.mock.calls[0]?.[0] as {
      eventId: string;
      payload: { eventId?: string };
    };
    expect(persisted.payload.eventId).toBe(persisted.eventId);
    expect(result).toEqual(existingRow);
  });

  it('schedules a retry after a network failure', async () => {
    const startedAt = new Date('2026-08-14T10:00:00.000Z');
    const outbox = createDueOutboxRow(startedAt);
    const attempts: Array<Record<string, unknown>> = [];
    const dispatcher = new VvAdminOutbox(
      createDispatchDatabase(outbox, attempts),
      {
        url: 'https://vv-admin.example.test/commerce/webhook',
        siteKey: 'flower-point',
        secret: 'secret',
        secretVersion: '1',
      },
      vi.fn().mockRejectedValue(new Error('network unavailable')),
      () => startedAt,
    );

    const [result] = await dispatcher.dispatchDueEvents({ limit: 1 });

    expect(result.status).toBe('retry_scheduled');
    expect(attempts[0]?.status).toBe('failed');
    expect(outbox.status).toBe('retry');
    expect(outbox.nextAttemptAt.getTime()).toBeGreaterThan(startedAt.getTime());
  });

  it('marks a 400 response as dead instead of retrying it', async () => {
    const startedAt = new Date('2026-08-14T10:00:00.000Z');
    const outbox = createDueOutboxRow(startedAt);
    const attempts: Array<Record<string, unknown>> = [];
    const dispatcher = new VvAdminOutbox(
      createDispatchDatabase(outbox, attempts),
      {
        url: 'https://vv-admin.example.test/commerce/webhook',
        siteKey: 'flower-point',
        secret: 'secret',
        secretVersion: '1',
      },
      vi.fn().mockResolvedValue(new Response(null, { status: 400 })),
      () => startedAt,
    );

    const [result] = await dispatcher.dispatchDueEvents({ limit: 1 });

    expect(result.status).toBe('dead');
    expect(attempts[0]?.status).toBe('failed');
    expect(attempts[0]?.httpStatus).toBe(400);
    expect(outbox.status).toBe('dead');
  });

  it('marks a successful delivery sent after persisting its attempt before fetch', async () => {
    const startedAt = new Date('2026-08-14T10:00:00.000Z');
    const outbox = createDueOutboxRow(startedAt);
    const attempts: Array<Record<string, unknown>> = [];
    const calls: string[] = [];
    const fetchFn = vi.fn(async (_url: string, request: RequestInit) => {
      calls.push('fetch');
      expect(attempts[0]).toMatchObject({ status: 'sending', attemptNumber: 1 });
      const rawBody = Buffer.from(request.body as Buffer);
      const body = JSON.parse(rawBody.toString()) as { eventId?: string };
      const headers = request.headers as Record<string, string>;
      expect(body.eventId).toBe(outbox.eventId);
      expect(headers['x-vv-event-id']).toBe(outbox.eventId);
      expect(headers['x-vv-signature']).toBe(
        signVvAdminWebhook({
          secret: dispatchConfig.secret,
          version: dispatchConfig.secretVersion,
          timestamp: startedAt.toISOString(),
          eventId: outbox.eventId,
          rawBody,
        }).signature,
      );
      return new Response(null, { status: 200 });
    });
    const dispatcher = new VvAdminOutbox(
      createDispatchDatabase(outbox, attempts, calls),
      dispatchConfig,
      fetchFn,
      () => startedAt,
    );

    const [result] = await dispatcher.dispatchDueEvents({ limit: 1 });

    expect(result).toEqual({ eventId: 'event-1', status: 'sent' });
    expect(calls).toEqual(['attempt_created', 'fetch']);
    expect(attempts[0]).toMatchObject({ status: 'sent', httpStatus: 200 });
    expect(outbox).toMatchObject({ status: 'sent', sentAt: startedAt });
  });

  it('reclaims an expired sending lease after failing the abandoned attempt', async () => {
    const startedAt = new Date('2026-08-14T10:00:00.000Z');
    const outbox = createDueOutboxRow(new Date('2026-08-14T09:59:00.000Z'));
    outbox.status = 'sending';
    outbox.attemptCount = 1;
    outbox.dispatchLeaseExpiresAt = new Date('2026-08-14T09:59:59.000Z');
    const attempts: Array<Record<string, unknown>> = [
      { id: 'attempt-1', attemptNumber: 1, status: 'sending' },
    ];
    const dispatcher = new VvAdminOutbox(
      createDispatchDatabase(outbox, attempts),
      dispatchConfig,
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
      () => startedAt,
    );

    const [result] = await dispatcher.dispatchDueEvents({ limit: 1 });

    expect(result.status).toBe('sent');
    expect(attempts[0]).toMatchObject({
      status: 'failed',
      errorMessage: 'VV Admin dispatch lease expired',
      finishedAt: startedAt,
    });
    expect(attempts[1]).toMatchObject({ status: 'sent', attemptNumber: 2 });
    expect(outbox).toMatchObject({
      status: 'sent',
      attemptCount: 2,
      dispatchLeaseExpiresAt: null,
    });
  });

  it('aborts a webhook request before its dispatch lease can expire', async () => {
    const startedAt = new Date('2026-08-14T10:00:00.000Z');
    const outbox = createDueOutboxRow(startedAt);
    const attempts: Array<Record<string, unknown>> = [];
    let abortObserved = false;
    const fetchFn = vi.fn((_url: string, request: RequestInit) => {
      if (!request.signal) {
        return Promise.reject(new Error('missing abort signal'));
      }
      return new Promise<Response>((_resolve, reject) => {
        request.signal!.addEventListener('abort', () => {
          abortObserved = true;
          reject(request.signal!.reason);
        }, { once: true });
      });
    });
    const dispatcher = new VvAdminOutbox(
      createDispatchDatabase(outbox, attempts),
      { ...dispatchConfig, requestTimeoutMs: 5 },
      fetchFn,
      () => startedAt,
    );

    const [result] = await dispatcher.dispatchDueEvents({ limit: 1 });

    expect(abortObserved).toBe(true);
    expect(result.status).toBe('retry_scheduled');
    expect(outbox.status).toBe('retry');
  });

  it('limits a sequential claim batch to work that fits inside the lease', async () => {
    const limit = vi.fn(() => ({
      for: vi.fn().mockResolvedValue([]),
    }));
    const db = {
      transaction: vi.fn((callback) => callback({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({ limit })),
            })),
          })),
        })),
      })),
    };
    const dispatcher = new VvAdminOutbox(db as never, dispatchConfig);

    await dispatcher.dispatchDueEvents({ limit: 100 });

    expect(limit).toHaveBeenCalledWith(27);
  });

  it.each([
    { httpStatus: 200, resultStatus: 'sent' },
    { httpStatus: 400, resultStatus: 'dead' },
    { httpStatus: 500, resultStatus: 'retry_scheduled' },
  ] as const)(
    'does not let a stale attempt overwrite a newer lease after HTTP $httpStatus',
    async ({ httpStatus, resultStatus }) => {
      const startedAt = new Date('2026-08-14T10:00:00.000Z');
      const outbox = createDueOutboxRow(startedAt);
      const attempts: Array<Record<string, unknown>> = [];
      const fetchFn = vi.fn(async () => {
        attempts[0]!.status = 'failed';
        outbox.status = 'sending';
        outbox.attemptCount = 2;
        attempts.push({ id: 'attempt-2', attemptNumber: 2, status: 'sending' });
        return new Response(null, { status: httpStatus });
      });
      const dispatcher = new VvAdminOutbox(
        createDispatchDatabase(outbox, attempts),
        dispatchConfig,
        fetchFn,
        () => startedAt,
      );

      const [result] = await dispatcher.dispatchDueEvents({ limit: 1 });

      expect(result.status).toBe(resultStatus);
      expect(outbox).toMatchObject({ status: 'sending', attemptCount: 2 });
      expect(attempts[0]).toMatchObject({ status: 'failed' });
      expect(attempts[1]).toMatchObject({ status: 'sending', attemptNumber: 2 });
    },
  );
});

const dispatchConfig = {
  url: 'https://vv-admin.example.test/commerce/webhook',
  siteKey: 'flower-point',
  secret: 'secret',
  secretVersion: '1',
};

function createDueOutboxRow(nextAttemptAt: Date) {
  return {
    id: 'outbox-1',
    eventId: 'event-1',
    payload: { eventType: 'order.created', data: { status: 'created' } },
    status: 'pending',
    attemptCount: 0,
    nextAttemptAt,
  } as {
    id: string;
    eventId: string;
    payload: Record<string, unknown>;
    status: string;
    attemptCount: number;
    nextAttemptAt: Date;
    [key: string]: unknown;
  };
}

function createDispatchDatabase(
  outbox: ReturnType<typeof createDueOutboxRow>,
  attempts: Array<Record<string, unknown>>,
  calls: string[] = [],
) {
  let claimedAttemptNumber = outbox.attemptCount;
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => ({
            for: vi.fn().mockResolvedValue([outbox]),
          })),
        })),
      })),
    })),
  }));
  const update = vi.fn((table: unknown) => ({
    set: vi.fn((values: Record<string, unknown>) => ({
      where: vi.fn().mockImplementation(async (condition: unknown) => {
        const referencedColumns = collectReferencedColumnNames(condition);
        if (table === vvAdminOutbox) {
          const isTerminalUpdate = 'status' in values
            && ['sent', 'dead', 'retry'].includes(String(values.status));
          const isFenced = referencedColumns.has('status')
            && referencedColumns.has('attempt_count');
          if (
            !isTerminalUpdate
            || !isFenced
            || (outbox.status === 'sending'
              && outbox.attemptCount === claimedAttemptNumber)
          ) {
            Object.assign(outbox, values);
            if (!isTerminalUpdate && typeof values.attemptCount === 'number') {
              claimedAttemptNumber = values.attemptCount;
            }
          }
        }
        if (table === vvAdminOutboxAttempts) {
          const attempt = attempts.find((candidate) =>
            candidate.attemptNumber === claimedAttemptNumber,
          ) ?? attempts.at(-1)!;
          const isFenced = referencedColumns.has('status');
          if (!isFenced || attempt.status === 'sending') {
            Object.assign(attempt, values);
          }
        }
      }),
    })),
  }));
  const insert = vi.fn((table: unknown) => ({
    values: vi.fn((values: Record<string, unknown>) => ({
      returning: vi.fn().mockImplementation(async () => {
        const attempt = { id: `attempt-${attempts.length + 1}`, ...values };
        if (table === vvAdminOutboxAttempts) {
          attempts.push(attempt);
          calls.push('attempt_created');
        }
        return [attempt];
      }),
    })),
  }));

  return {
    transaction: vi.fn((callback) => callback({ select, update, insert })),
  };
}

function collectReferencedColumnNames(value: unknown, seen = new Set<unknown>()): Set<string> {
  const names = new Set<string>();
  if (!value || typeof value !== 'object' || seen.has(value)) return names;
  seen.add(value);

  const record = value as Record<string, unknown>;
  if (typeof record.name === 'string' && 'table' in record) {
    names.add(record.name);
    return names;
  }
  for (const child of Object.values(record)) {
    for (const name of collectReferencedColumnNames(child, seen)) names.add(name);
  }
  return names;
}
