import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { listings } from './listings';
import { sellers } from './sellers';
import { users } from './users';

export const orderStatusEnum = pgEnum('order_status', [
  'pending',
  'paid',
  'shipped',
  'delivered',
  'cancelled',
]);

export const currencyEnum = pgEnum('display_currency', ['KZT', 'TRY', 'RUB']);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: orderStatusEnum('status').notNull().default('pending'),
    subtotalUsd: numeric('subtotal_usd', {
      precision: 12,
      scale: 2,
    }).notNull(),
    commissionUsd: numeric('commission_usd', {
      precision: 12,
      scale: 2,
    }).notNull(),
    deliveryFeeUsd: numeric('delivery_fee_usd', {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default('0.00'),
    estimatedDeliveryWeightKg: integer('estimated_delivery_weight_kg')
      .notNull()
      .default(0),
    estimatedDeliveryStems: integer('estimated_delivery_stems')
      .notNull()
      .default(0),
    deliveryCountryCode: text('delivery_country_code'),
    deliveryCityValue: text('delivery_city_value'),
    totalUsd: numeric('total_usd', { precision: 12, scale: 2 }).notNull(),
    displayCurrency: currencyEnum('display_currency').notNull().default('TRY'),
    shippingAddress: jsonb('shipping_address').notNull(),
    notes: text('notes'),
    merchantOrderId: text('merchant_order_id').unique(),
    checkoutKey: text('checkout_key'),
    requestHash: text('request_hash'),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>(),
    synthetic: boolean('synthetic').notNull().default(false),
    scenarioRunId: text('scenario_run_id'),
    scenarioPaymentUrlHost: text('scenario_payment_url_host'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    checkoutKeyIdx: uniqueIndex("orders_buyer_checkout_key").on(table.buyerId, table.checkoutKey).where(sql`${table.checkoutKey} is not null`),
    scenarioRunIdIdx: uniqueIndex('orders_scenario_run_id_unique_idx')
      .on(table.scenarioRunId)
      .where(sql`${table.scenarioRunId} is not null`),
  }),
);

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  listingId: uuid('listing_id')
    .notNull()
    .references(() => listings.id, { onDelete: 'restrict' }),
  sellerId: uuid('seller_id')
    .notNull()
    .references(() => sellers.id, { onDelete: 'restrict' }),
  quantity: integer('quantity').notNull(),
  reservedStems: integer('reserved_stems').notNull().default(0),
  unitPriceUsd: numeric('unit_price_usd', {
    precision: 12,
    scale: 2,
  }).notNull(),
  totalPriceUsd: numeric('total_price_usd', {
    precision: 12,
    scale: 2,
  }).notNull(),
  deliveryDate: date('delivery_date').notNull(),
  productName: text('product_name'),
});

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
