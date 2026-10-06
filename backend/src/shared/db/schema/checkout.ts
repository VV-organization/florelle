import { pgTable, uuid, text, bigint, timestamp } from "drizzle-orm/pg-core";
import { orders } from "./orders";
export const checkoutAttempts = pgTable("checkout_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .unique()
    .references(() => orders.id),
  merchantOrderId: text("merchant_order_id").notNull().unique(),
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
