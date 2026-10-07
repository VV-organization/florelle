import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../shared/db/client";
import {
  checkoutAttempts,
  orders,
  orderItems,
  payments,
  listings,
  users,
  paymentEmails,
} from "../../shared/db/schema";
import type { ArcPayment } from "./arc-pay-client";
export type ArcPayOutbox = {
  enqueueOrderEvent(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    input: {
      eventType: "order.paid" | "order.cancelled" | "order.payment_reached";
      source: string;
      order: typeof orders.$inferSelect;
      items: (typeof orderItems.$inferSelect)[];
      payment: { status: string; provider: string; paidAt: Date | null };
    },
  ): Promise<unknown>;
};
const paid = new Set(["captured", "settled"]);
const failed = new Set(["declined", "failed", "expired", "voided"]);
const pending = new Set([
  "created",
  "pending",
  "pending_3ds",
  "authorized",
  "timeout",
]);

/** All settlement paths share the same locks, validation and transactional outboxes. */
export async function projectArcPayment(
  db: Database,
  attemptId: string,
  payment: ArcPayment,
  environment: string,
  outbox?: ArcPayOutbox,
): Promise<string> {
  return db.transaction(async (tx) => {
    const [attempt] = await tx
      .select()
      .from(checkoutAttempts)
      .where(
        and(
          eq(checkoutAttempts.id, attemptId),
          eq(checkoutAttempts.provider, "arc_pay"),
        ),
      )
      .for("update");
    if (!attempt) return "unmatched";
    if (attempt.environment !== environment) return "environment_mismatch";
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, attempt.orderId))
      .for("update");
    if (!order) throw Error("ARC_ORDER_MISSING");
    const review = async (reason: string) => {
      await tx
        .update(checkoutAttempts)
        .set({
          state: "review",
          reviewReason: reason,
          providerStatus: payment.status,
          updatedAt: new Date(),
        })
        .where(eq(checkoutAttempts.id, attempt.id));
      return reason;
    };
    if (payment.external_id !== attempt.id) return "external_id_mismatch";
    if (
      payment.amount !== attempt.amountMinor ||
      payment.currency !== attempt.currency
    )
      return review("amount_currency_mismatch");
    if (
      payment.payment_method !== "sbp" ||
      (payment.payment_mode && payment.payment_mode !== "h2h")
    )
      return review("method_mismatch");
    if (
      payment.metadata?.florelle_order_id &&
      payment.metadata.florelle_order_id !== order.id
    )
      return review("order_mismatch");
    if (attempt.externalId && attempt.externalId !== payment.id)
      return review("multiple_payments");
    // Manual-review anomalies are sticky; a routine poll must not clear them.
    if (
      attempt.state === "review" &&
      !["creation_window_expired", "creation_rejected"].includes(
        attempt.reviewReason ?? "",
      )
    )
      return "review";
    const [other] = await tx
      .select({ orderId: payments.orderId })
      .from(payments)
      .where(eq(payments.externalId, payment.id));
    if (other && other.orderId !== order.id) return review("identity_conflict");
    await tx
      .insert(payments)
      .values({
        orderId: order.id,
        provider: "arc_pay",
        externalId: payment.id,
        amountUsd: order.totalUsd,
        status: "pending",
      })
      .onConflictDoNothing({ target: payments.externalId });
    await tx
      .update(checkoutAttempts)
      .set({
        externalId: payment.id,
        providerStatus: payment.status,
        updatedAt: new Date(),
      })
      .where(eq(checkoutAttempts.id, attempt.id));
    if (["refunded", "chargeback"].includes(payment.status))
      return review(payment.status);
    if ((payment.refunded_amount ?? 0) > 0) return review("refunded");
    if (pending.has(payment.status)) return "pending";
    if (!paid.has(payment.status) && !failed.has(payment.status))
      return review("unknown_status");
    const isPaid = paid.has(payment.status);
    if (
      isPaid &&
      payment.captured_amount !== undefined &&
      payment.captured_amount !== attempt.amountMinor
    )
      return review("capture_amount_mismatch");
    if (["paid", "shipped", "delivered"].includes(order.status))
      return "already_paid";
    if (order.status === "cancelled")
      return isPaid ? review("capture_after_cancellation") : "already_failed";
    if (order.status !== "pending") return review("order_state_conflict");
    const items = await tx
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    if (!isPaid) {
      const reserved = new Map<string, number>();
      for (const item of items)
        reserved.set(
          item.listingId,
          (reserved.get(item.listingId) ?? 0) + item.reservedStems,
        );
      for (const [listingId, stems] of [...reserved].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const [restored] = await tx
          .update(listings)
          .set({ availableStems: sql`${listings.availableStems} + ${stems}` })
          .where(eq(listings.id, listingId))
          .returning({ id: listings.id });
        if (!restored) throw Error("ARC_LISTING_MISSING");
      }
    }
    const now = new Date();
    await tx
      .update(orders)
      .set({ status: isPaid ? "paid" : "cancelled", updatedAt: now })
      .where(eq(orders.id, order.id));
    await tx
      .update(payments)
      .set({ status: isPaid ? "completed" : "failed", updatedAt: now })
      .where(eq(payments.externalId, payment.id));
    await tx
      .update(checkoutAttempts)
      .set({
        state: isPaid ? "paid" : "failed",
        reviewReason: null,
        updatedAt: now,
      })
      .where(eq(checkoutAttempts.id, attempt.id));
    await outbox?.enqueueOrderEvent(tx, {
      eventType: isPaid ? "order.paid" : "order.cancelled",
      source: order.synthetic ? "scenario" : "customer",
      order,
      items,
      payment: {
        status: isPaid ? "paid" : "failed",
        provider: "arc_pay",
        paidAt: isPaid ? now : null,
      },
    });
    if (isPaid && !order.synthetic) {
      const [buyer] = await tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, order.buyerId));
      if (!buyer) throw Error("ARC_BUYER_MISSING");
      await tx
        .insert(paymentEmails)
        .values({
          orderId: order.id,
          payload: {
            to: attempt.requestSnapshot?.customer_email ?? buyer.email,
            totalUsd: order.totalUsd,
            amountRub: (attempt.amountMinor / 100).toFixed(2),
            paidAt: now.toISOString(),
          },
        })
        .onConflictDoNothing({ target: paymentEmails.orderId });
    }
    return isPaid ? "paid" : "failed";
  });
}
