import {
  pgTable,
  text,
  timestamp,
  integer,
  uuid,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { orders } from "./orders";
export const arcPayEvents = pgTable(
  "arc_pay_events",
  {
    id: text("id").primaryKey(),
    environment: text("environment").notNull(),
    eventType: text("event_type").notNull(),
    paymentId: text("payment_id").notNull(),
    status: text("status").notNull().default("received"),
    reason: text("reason"),
    retryCount: integer("retry_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    leaseToken: uuid("lease_token"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({ due: index("arc_pay_events_due").on(t.status, t.nextAttemptAt) }),
);
export const paymentEmails = pgTable(
  "payment_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => orders.id),
    payload: jsonb("payload")
      .notNull()
      .$type<{
        to: string;
        totalUsd: string;
        amountRub: string;
        paidAt: string;
      }>(),
    status: text("status").notNull().default("pending"),
    retryCount: integer("retry_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    leaseToken: uuid("lease_token"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({ due: index("payment_emails_due").on(t.status, t.nextAttemptAt) }),
);

// Shared across backend replicas; this deployment has one Arc merchant per environment.
export const arcPayRateLimits = pgTable("arc_pay_rate_limits", {
  scope: text("scope").primaryKey(),
  blockedUntil: timestamp("blocked_until", { withTimezone: true })
    .notNull()
    .defaultNow(),
  nextRequestAt: timestamp("next_request_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
