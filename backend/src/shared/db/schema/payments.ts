import { sql } from 'drizzle-orm';
import {
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { orders } from './orders';

export const paymentProviderEnum = pgEnum('payment_provider', ['arcopay', 'arc_pay']);
export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'completed',
  'failed',
]);

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'restrict' }),
  provider: paymentProviderEnum('provider').notNull(),
  externalId: text('external_id').notNull().unique(),
  amountUsd: numeric('amount_usd', { precision: 12, scale: 2 }).notNull(),
  status: paymentStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
