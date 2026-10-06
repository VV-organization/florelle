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
import { users } from './users';

export const balanceTopUpStatusEnum = pgEnum('balance_top_up_status', [
  'pending',
  'completed',
  'failed',
  'cancelled',
]);

export const balanceTransactionTypeEnum = pgEnum('balance_transaction_type', [
  'top_up',
  'purchase',
  'refund',
  'adjustment',
]);

export const balanceTopUps = pgTable('balance_top_ups', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  merchantOrderId: text('merchant_order_id').notNull().unique(),
  arcopayOrderId: text('arcopay_order_id').unique(),
  amountUsd: numeric('amount_usd', { precision: 12, scale: 2 }).notNull(),
  amountRub: numeric('amount_rub', { precision: 12, scale: 2 }).notNull(),
  fxRate: numeric('fx_rate', { precision: 18, scale: 6 }).notNull(),
  paymentUrl: text('payment_url'),
  buyerEmail: text('buyer_email'),
  buyerPhone: text('buyer_phone'),
  status: balanceTopUpStatusEnum('status').notNull().default('pending'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const balanceTransactions = pgTable('balance_transactions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  type: balanceTransactionTypeEnum('type').notNull(),
  amountUsd: numeric('amount_usd', { precision: 12, scale: 2 }).notNull(),
  balanceAfterUsd: numeric('balance_after_usd', {
    precision: 12,
    scale: 2,
  }).notNull(),
  topUpId: uuid('top_up_id').references(() => balanceTopUps.id, {
    onDelete: 'restrict',
  }),
  orderId: uuid('order_id').references(() => orders.id, {
    onDelete: 'restrict',
  }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type BalanceTopUp = typeof balanceTopUps.$inferSelect;
export type NewBalanceTopUp = typeof balanceTopUps.$inferInsert;
export type BalanceTransaction = typeof balanceTransactions.$inferSelect;
export type NewBalanceTransaction = typeof balanceTransactions.$inferInsert;
