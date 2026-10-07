import { AppError } from "../../shared/middleware/error.middleware";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../shared/db/client";
import {
  checkoutAttempts,
  arcPayEvents,
  paymentEmails,
  orders,
  orderItems,
} from "../../shared/db/schema";
import {
  ArcPayClient,
  ArcPayError,
  type ArcSessionRequest,
} from "./arc-pay-client";
import { projectArcPayment, type ArcPayOutbox } from "./arc-pay-settlement";
import type { NotificationsService } from "../notifications/notifications.service";

const LEASE_MS = 120000;
// Stop a minute early so a request cannot cross the provider's 72h deadline in transit.
const CREATE_WINDOW_MS = 72 * 3600000 - 60000;
const backoff = (count: number, error?: unknown) =>
  Math.max(
    Math.min(300000, 15000 * 2 ** Math.min(count, 5)),
    error instanceof ArcPayError ? error.retryAfterMs : 0,
  );
const eventSchema = z.object({
  event_type: z.string().min(1).max(100),
  data: z.object({
    payment_id: z.string().min(1).max(255).optional(),
    id: z.string().min(1).max(255).optional(),
  }),
});
export class ArcPayService {
  private running = false;
  constructor(
    private db: Database,
    readonly client: ArcPayClient,
    private outbox?: ArcPayOutbox,
    private notifications?: Pick<NotificationsService, "sendOrderPaid">,
  ) {}
  get environment() {
    return this.client.environment;
  }
  assertAvailable(amount?: number) {
    return this.client.assertAvailable(amount);
  }
  async prepareCheckout(): Promise<(amount: number) => void> {
    let validate: (amount: number) => void;
    try {
      validate = await this.client.amountValidator();
    } catch {
      throw new AppError(
        503,
        "PAYMENT_METHOD_UNAVAILABLE",
        "Оплата через СБП временно недоступна",
      );
    }
    return (amount) => {
      try {
        validate(amount);
      } catch {
        throw new AppError(
          400,
          "PAYMENT_AMOUNT_UNAVAILABLE",
          "Сумма заказа выходит за доступные лимиты оплаты СБП",
        );
      }
    };
  }
  sessionRequest(input: {
    attemptId: string;
    orderId: string;
    amount: number;
    email: string;
    returnUrl: string;
  }): ArcSessionRequest {
    return {
      amount: input.amount,
      currency: "RUB",
      capture_mode: "one_stage",
      payment_methods: [{ method: "sbp", payment_mode: "h2h" }],
      external_id: input.attemptId,
      customer_email: input.email,
      success_url: input.returnUrl,
      fail_url: input.returnUrl,
      cancel_url: input.returnUrl,
      locale: "ru",
      metadata: { florelle_order_id: input.orderId },
      description: `Florelle order ${input.orderId}`,
    };
  }
  async advance(orderId: string) {
    const token = randomUUID(),
      now = new Date();
    const [attempt] = await this.db
      .update(checkoutAttempts)
      .set({
        state: "creating",
        leaseToken: token,
        leaseUntil: new Date(now.getTime() + LEASE_MS),
        firstRequestAt: sql`coalesce(${checkoutAttempts.firstRequestAt}, ${now.toISOString()}::timestamptz)`,
        updatedAt: now,
      })
      .where(
        and(
          eq(checkoutAttempts.orderId, orderId),
          eq(checkoutAttempts.provider, "arc_pay"),
          eq(checkoutAttempts.environment, this.environment),
          inArray(checkoutAttempts.state, ["created", "creating"]),
          lte(checkoutAttempts.nextAttemptAt, now),
          sql`(${checkoutAttempts.leaseUntil} IS NULL OR ${checkoutAttempts.leaseUntil} < now())`,
        ),
      )
      .returning();
    if (!attempt) return;
    const owned = and(
      eq(checkoutAttempts.id, attempt.id),
      eq(checkoutAttempts.leaseToken, token),
    );
    try {
      if (!attempt.requestSnapshot) throw Error("ARC_REQUEST_SNAPSHOT_MISSING");
      if (
        now.getTime() - attempt.firstRequestAt!.getTime() >=
        CREATE_WINDOW_MS
      ) {
        // Reconciliation can still recover a paid attempt; never issue a new session here.
        await this.db
          .update(checkoutAttempts)
          .set({
            state: "review",
            reviewReason: "creation_window_expired",
            leaseUntil: null,
            leaseToken: null,
            updatedAt: new Date(),
          })
          .where(owned);
        return;
      }
      await this.assertAvailable(attempt.amountMinor);
      const session = await this.client.createSession(
        attempt.requestSnapshot,
        attempt.id,
        attempt.firstRequestAt!.getTime() + CREATE_WINDOW_MS,
      );
      await this.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(checkoutAttempts)
          .where(owned)
          .for("update");
        if (!current) return;
        if (current.sessionId && current.sessionId !== session.id)
          throw Error("ARC_SESSION_CONFLICT");
        const canReady = ["creating", "created"].includes(current.state);
        await tx
          .update(checkoutAttempts)
          .set({
            sessionId: session.id,
            paymentUrl: session.url,
            state: canReady ? "ready" : current.state,
            leaseUntil: null,
            leaseToken: null,
            retryCount: 0,
            nextAttemptAt: new Date(Date.now() + 15000),
            updatedAt: new Date(),
          })
          .where(owned);
        if (canReady && !current.sessionId) {
          const [order] = await tx
            .select()
            .from(orders)
            .where(eq(orders.id, orderId));
          if (!order || order.status !== "pending") return;
          if (order.synthetic)
            await tx
              .update(orders)
              .set({ scenarioPaymentUrlHost: new URL(session.url).host })
              .where(eq(orders.id, orderId));
          const items = await tx
            .select()
            .from(orderItems)
            .where(eq(orderItems.orderId, orderId));
          await this.outbox?.enqueueOrderEvent(tx, {
            eventType: "order.payment_reached",
            source: order.synthetic ? "scenario" : "customer",
            order,
            items,
            payment: { status: "pending", provider: "arc_pay", paidAt: null },
          });
        }
      });
    } catch (error) {
      const rejected = error instanceof ArcPayError && !error.retryable;
      const expired =
        error instanceof Error && error.message === "ARC_CREATE_WINDOW_EXPIRED";
      await this.db
        .update(checkoutAttempts)
        .set({
          ...(rejected || expired
            ? {
                state: "review",
                reviewReason: expired
                  ? "creation_window_expired"
                  : "creation_rejected",
              }
            : {}),
          leaseUntil: null,
          leaseToken: null,
          retryCount: attempt.retryCount + 1,
          nextAttemptAt: new Date(
            Date.now() + backoff(attempt.retryCount, error),
          ),
          updatedAt: new Date(),
        })
        .where(and(owned, eq(checkoutAttempts.state, "creating")));
      // If a webhook settled while creation was in flight, only release this lease.
      await this.db
        .update(checkoutAttempts)
        .set({ leaseUntil: null, leaseToken: null })
        .where(owned);
    }
  }
  async receive(id: string, body: unknown) {
    const event = eventSchema.parse(body),
      paymentId = event.data.payment_id ?? event.data.id;
    if (!paymentId) throw Error("ARC_EVENT_PAYMENT_MISSING");
    // Keep only routing fields, not raw customer data from provider payloads.
    await this.db
      .insert(arcPayEvents)
      .values({
        id,
        environment: this.environment,
        eventType: event.event_type,
        paymentId,
      })
      .onConflictDoNothing({ target: arcPayEvents.id });
  }
  async reconcile(orderId: string) {
    const [attempt] = await this.db
      .select()
      .from(checkoutAttempts)
      .where(
        and(
          eq(checkoutAttempts.orderId, orderId),
          eq(checkoutAttempts.provider, "arc_pay"),
          eq(checkoutAttempts.environment, this.environment),
        ),
      );
    if (!attempt) return "unmatched";
    const found = await this.client.findPayments(attempt.id);
    if (found.length > 1) {
      await this.db
        .update(checkoutAttempts)
        .set({
          state: "review",
          reviewReason: "multiple_payments",
          updatedAt: new Date(),
        })
        .where(eq(checkoutAttempts.id, attempt.id));
      return "multiple_payments";
    }
    if (!found.length && !attempt.externalId) return "pending";
    const id = found[0]?.id ?? attempt.externalId!;
    const payment = await this.client.getPayment(id);
    return projectArcPayment(
      this.db,
      attempt.id,
      payment,
      this.environment,
      this.outbox,
    );
  }
  async processEvents() {
    const rows = await this.db
      .select()
      .from(arcPayEvents)
      .where(
        and(
          eq(arcPayEvents.status, "received"),
          eq(arcPayEvents.environment, this.environment),
          lte(arcPayEvents.nextAttemptAt, new Date()),
          sql`(${arcPayEvents.leaseUntil} IS NULL OR ${arcPayEvents.leaseUntil} < now())`,
        ),
      )
      .orderBy(arcPayEvents.nextAttemptAt)
      .limit(10);
    for (const row of rows) {
      const token = randomUUID();
      const [claim] = await this.db
        .update(arcPayEvents)
        .set({ leaseToken: token, leaseUntil: new Date(Date.now() + LEASE_MS) })
        .where(
          and(
            eq(arcPayEvents.id, row.id),
            eq(arcPayEvents.status, "received"),
            sql`(${arcPayEvents.leaseUntil} IS NULL OR ${arcPayEvents.leaseUntil} < now())`,
          ),
        )
        .returning();
      if (!claim) continue;
      const owned = and(
        eq(arcPayEvents.id, row.id),
        eq(arcPayEvents.leaseToken, token),
      );
      try {
        if (!row.eventType.startsWith("payment.")) {
          await this.db
            .update(arcPayEvents)
            .set({
              status: "ignored",
              reason: "unknown_event",
              leaseUntil: null,
              leaseToken: null,
            })
            .where(owned);
          continue;
        }
        const payment = await this.client.getPayment(row.paymentId);
        if (
          !payment.external_id ||
          !z.string().uuid().safeParse(payment.external_id).success
        ) {
          await this.db
            .update(arcPayEvents)
            .set({
              status: "unmatched",
              reason: "unknown_external_id",
              leaseUntil: null,
              leaseToken: null,
            })
            .where(owned);
          continue;
        }
        const [attempt] = await this.db
          .select()
          .from(checkoutAttempts)
          .where(
            and(
              eq(checkoutAttempts.id, payment.external_id),
              eq(checkoutAttempts.provider, "arc_pay"),
              eq(checkoutAttempts.environment, this.environment),
            ),
          );
        if (!attempt) {
          await this.db
            .update(arcPayEvents)
            .set({
              status: "unmatched",
              reason: "unknown_attempt",
              leaseUntil: null,
              leaseToken: null,
            })
            .where(owned);
          continue;
        }
        // Search also catches multiple provider payments associated with the same intent.
        const found = await this.client.findPayments(attempt.id);
        let reason: string;
        if (new Set([payment.id, ...found.map((p) => p.id)]).size > 1) {
          await this.db
            .update(checkoutAttempts)
            .set({
              state: "review",
              reviewReason: "multiple_payments",
              updatedAt: new Date(),
            })
            .where(eq(checkoutAttempts.id, attempt.id));
          reason = "multiple_payments";
        } else
          reason = await projectArcPayment(
            this.db,
            attempt.id,
            payment,
            this.environment,
            this.outbox,
          );
        await this.db
          .update(arcPayEvents)
          .set({
            status: "processed",
            reason,
            leaseUntil: null,
            leaseToken: null,
          })
          .where(owned);
      } catch (error) {
        await this.db
          .update(arcPayEvents)
          .set({
            retryCount: row.retryCount + 1,
            nextAttemptAt: new Date(
              Date.now() + backoff(row.retryCount, error),
            ),
            leaseUntil: null,
            leaseToken: null,
            reason: "processing_retry",
          })
          .where(owned);
      }
    }
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.processEvents();
      const rows = await this.db
        .select()
        .from(checkoutAttempts)
        .where(
          and(
            eq(checkoutAttempts.provider, "arc_pay"),
            eq(checkoutAttempts.environment, this.environment),
            inArray(checkoutAttempts.state, [
              "created",
              "creating",
              "ready",
              "review",
            ]),
            lte(checkoutAttempts.nextAttemptAt, new Date()),
            sql`(${checkoutAttempts.leaseUntil} IS NULL OR ${checkoutAttempts.leaseUntil} < now())`,
          ),
        )
        .orderBy(checkoutAttempts.nextAttemptAt)
        .limit(10);
      for (const row of rows) {
        if (["created", "creating"].includes(row.state)) {
          await this.advance(row.orderId);
          continue;
        }
        const token = randomUUID();
        const [claim] = await this.db
          .update(checkoutAttempts)
          .set({
            leaseToken: token,
            leaseUntil: new Date(Date.now() + LEASE_MS),
          })
          .where(
            and(
              eq(checkoutAttempts.id, row.id),
              sql`(${checkoutAttempts.leaseUntil} IS NULL OR ${checkoutAttempts.leaseUntil} < now())`,
            ),
          )
          .returning();
        if (!claim) continue;
        let error: unknown;
        try {
          await this.reconcile(row.orderId);
        } catch (e) {
          error = e;
        }
        await this.db
          .update(checkoutAttempts)
          .set({
            leaseUntil: null,
            leaseToken: null,
            retryCount: error ? row.retryCount + 1 : 0,
            nextAttemptAt: new Date(
              Date.now() +
                (error
                  ? backoff(row.retryCount, error)
                  : row.state === "review"
                    ? 300000
                    : 15000),
            ),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(checkoutAttempts.id, row.id),
              eq(checkoutAttempts.leaseToken, token),
            ),
          );
      }
      await this.sendEmails();
    } finally {
      this.running = false;
    }
  }
  private async sendEmails() {
    if (!this.notifications) return;
    const rows = await this.db
      .select()
      .from(paymentEmails)
      .where(
        and(
          eq(paymentEmails.status, "pending"),
          lte(paymentEmails.nextAttemptAt, new Date()),
          sql`(${paymentEmails.leaseUntil} IS NULL OR ${paymentEmails.leaseUntil} < now())`,
        ),
      )
      .orderBy(paymentEmails.nextAttemptAt)
      .limit(10);
    for (const row of rows) {
      const token = randomUUID();
      const [claim] = await this.db
        .update(paymentEmails)
        .set({ leaseToken: token, leaseUntil: new Date(Date.now() + LEASE_MS) })
        .where(
          and(
            eq(paymentEmails.id, row.id),
            eq(paymentEmails.status, "pending"),
            sql`(${paymentEmails.leaseUntil} IS NULL OR ${paymentEmails.leaseUntil} < now())`,
          ),
        )
        .returning();
      if (!claim) continue;
      const owned = and(
        eq(paymentEmails.id, row.id),
        eq(paymentEmails.leaseToken, token),
      );
      try {
        await this.notifications.sendOrderPaid({
          ...row.payload,
          orderId: row.orderId,
          paidAt: new Date(row.payload.paidAt),
          idempotencyKey: `order-paid/${row.orderId}`,
        });
        await this.db
          .update(paymentEmails)
          .set({ status: "sent", leaseUntil: null, leaseToken: null })
          .where(owned);
      } catch {
        await this.db
          .update(paymentEmails)
          .set({
            retryCount: row.retryCount + 1,
            nextAttemptAt: new Date(Date.now() + backoff(row.retryCount)),
            leaseUntil: null,
            leaseToken: null,
          })
          .where(owned);
      }
    }
  }
}
