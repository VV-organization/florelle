import { and, eq, inArray, asc } from "drizzle-orm";
import type { Database } from "../../shared/db/client";
import { payments } from "../../shared/db/schema/payments";
import { orders } from "../../shared/db/schema/orders";
import { checkoutAttempts } from "../../shared/db/schema/checkout";
import type { PaymentProvider, WebhookPayload } from "../payments/payment-provider";
import {
  WebhookService,
  type PaymentIntegrationOutbox,
} from "../payments/payments.service";
import type { NotificationsService } from "../notifications/notifications.service";
/** Strict boundary for Florelle attempts, delegating atomic stock/status projection to the existing engine. */
export class CommerceWebhookService extends WebhookService {
  constructor(
    private database: Database,
    private provider: PaymentProvider,
    outbox?: PaymentIntegrationOutbox,
    notifications?: NotificationsService,
  ) {
    super(database, provider, outbox, notifications);
  }
  override async handleCallback(
    rawBody: Buffer,
    signature: string,
    body: unknown,
  ) {
    if (!this.provider.verifyWebhookSignature(rawBody, signature))
      return { handled: false, reason: "invalid_signature" };
    let payload;
    try {
      payload = this.provider.parseWebhookPayload(body);
    } catch {
      return { handled: false, reason: "parse_failed" };
    }
    if (this.provider.getPaymentStatus) {
      const status = await this.provider.getPaymentStatus(payload.externalId);
      if (status.externalId !== payload.externalId || status.merchantOrderId !== payload.merchantOrderId || status.amountMinor !== payload.amountMinor || status.currency !== payload.currency)
        return { handled: false, reason: "payment_amount_mismatch" };
      payload = status;
    }
    return this.applyVerifiedPayload(payload);
  }

  async reconcileOrder(orderId: string) {
    if (!this.provider.getPaymentStatus) return;
    const [attempt] = await this.database.select().from(checkoutAttempts)
      .where(and(eq(checkoutAttempts.orderId, orderId), eq(checkoutAttempts.provider, "arcopay"))).limit(1);
    if (!attempt?.externalId || ["paid", "failed"].includes(attempt.state)) return;
    const payload = await this.provider.getPaymentStatus(attempt.externalId);
    if (payload.externalId !== attempt.externalId) throw new Error("Provider identity mismatch");
    return this.applyVerifiedPayload(payload);
  }

  async reconcilePending() {
    if (!this.provider.getPaymentStatus) return;
    const attempts = await this.database.select({orderId: checkoutAttempts.orderId}).from(checkoutAttempts)
      .where(and(eq(checkoutAttempts.provider, "arcopay"), inArray(checkoutAttempts.state, ["ready", "created_external"])))
      .orderBy(asc(checkoutAttempts.updatedAt)).limit(25);
    for (const attempt of attempts) {
      try { await this.reconcileOrder(attempt.orderId); }
      finally { await this.database.update(checkoutAttempts).set({updatedAt: new Date()}).where(eq(checkoutAttempts.orderId,attempt.orderId)); }
    }
  }

  private async applyVerifiedPayload(payload: WebhookPayload) {
    let [attempt] = await this.database
      .select()
      .from(checkoutAttempts)
      .where(and(eq(checkoutAttempts.externalId, payload.externalId), eq(checkoutAttempts.provider, "arcopay")))
      .limit(1);
    if (!attempt && payload.externalId && payload.merchantOrderId) {
      // A signed provider callback can recover an identity lost with /create's response.
      // Lock the intent so concurrent callbacks and the original response bind it once.
      attempt = await this.database.transaction(async (tx) => {
        const [intent] = await tx
          .select()
          .from(checkoutAttempts)
          .where(and(eq(checkoutAttempts.merchantOrderId, payload.merchantOrderId), eq(checkoutAttempts.provider, "arcopay")))
          .for("update");
        if (
          !intent ||
          payload.currency !== intent.currency ||
          payload.amountMinor !== intent.amountMinor
        )
          return undefined;
        if (intent.externalId)
          return intent.externalId === payload.externalId ? intent : undefined;
        if (!["creating", "review"].includes(intent.state)) return undefined;
        const [order] = await tx
          .select()
          .from(orders)
          .where(eq(orders.id, intent.orderId));
        if (!order || order.status !== "pending") return undefined;
        await tx
          .insert(payments)
          .values({
            orderId: order.id,
            provider: "arcopay",
            externalId: payload.externalId,
            amountUsd: order.totalUsd,
            status: "pending",
          });
        const [bound] = await tx
          .update(checkoutAttempts)
          .set({
            externalId: payload.externalId,
            state: "created_external",
            leaseUntil: null,
            updatedAt: new Date(),
          })
          .where(eq(checkoutAttempts.id, intent.id))
          .returning();
        return bound;
      });
    }
    if (!attempt) return { handled: false, reason: "payment_not_found" };
    if (attempt.merchantOrderId !== payload.merchantOrderId)
      return { handled: false, reason: "merchant_order_mismatch" };
    if (
      payload.currency !== attempt.currency ||
      payload.amountMinor !== attempt.amountMinor
    )
      return { handled: false, reason: "payment_amount_mismatch" };
    const result = await super.processPayload(payload);
    if (result.handled) {
      const [order] = await this.database
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, attempt.orderId))
        .limit(1);
      const state =
        order && ["paid", "shipped", "delivered"].includes(order.status)
          ? "paid"
          : order?.status === "cancelled"
            ? "failed"
            : null;
      if (state)
        await this.database
          .update(checkoutAttempts)
          .set({ state, updatedAt: new Date() })
          .where(eq(checkoutAttempts.id, attempt.id));
    }
    return result;
  }
}
