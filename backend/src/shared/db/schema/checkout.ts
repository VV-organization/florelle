import { pgTable, uuid, text, bigint, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { orders } from "./orders";
export const checkoutAttempts = pgTable("checkout_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .unique()
    .references(() => orders.id),
  merchantOrderId: text("merchant_order_id").notNull().unique(),
  provider: text('provider').notNull().default('arcopay'),
  environment: text('environment'),
  sessionId: text('session_id').unique(),
  requestSnapshot: jsonb('request_snapshot').$type<import('../../../modules/payments/arc-pay-client').ArcSessionRequest>(),
  firstRequestAt: timestamp('first_request_at', { withTimezone: true }),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  retryCount: integer('retry_count').notNull().default(0),
  leaseToken: uuid('lease_token'),
  providerStatus: text('provider_status'),
  reviewReason: text('review_reason'),
  state: text("state").notNull().default("created"),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("RUB"),
  externalId: text("external_id").unique(),
  paymentUrl: text("payment_url"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
