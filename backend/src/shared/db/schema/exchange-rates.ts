import { sql } from 'drizzle-orm';
import {
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    base: text('base').notNull(),
    target: text('target').notNull(),
    rate: numeric('rate', { precision: 18, scale: 8 }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    baseTargetIdx: uniqueIndex('exchange_rates_base_target_idx').on(
      t.base,
      t.target,
    ),
  }),
);

export type ExchangeRate = typeof exchangeRates.$inferSelect;
export type NewExchangeRate = typeof exchangeRates.$inferInsert;
