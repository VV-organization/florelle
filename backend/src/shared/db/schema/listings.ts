import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  integer,
  numeric,
  pgTable,
  timestamp,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { products } from './products';
import { sellers } from './sellers';

export const listings = pgTable('listings', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  sellerId: uuid('seller_id')
    .notNull()
    .references(() => sellers.id, { onDelete: 'cascade' }),
  priceCurrency: text('price_currency'),
  wholesalePrice: numeric('wholesale_price', { precision:18,scale:6 }),
  retailPrice: numeric('retail_price', { precision:18,scale:6 }),
  referencePrice: numeric('reference_price', { precision:18,scale:6 }),
  sortOrder: integer('sort_order').notNull().default(0),
  sellerPriceUsd: numeric('seller_price_usd', {
    precision: 12,
    scale: 2,
  }).notNull(),
  amsPriceUsd: numeric('ams_price_usd', {
    precision: 12,
    scale: 2,
  }).notNull(),
  boxQuantity: integer('box_quantity').notNull(),
  availableStems: integer('available_stems').notNull().default(0),
  deliveryDate: date('delivery_date').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
