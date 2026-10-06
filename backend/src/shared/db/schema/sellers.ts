import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { LocalizedField } from './types';

export const sellers = pgTable('sellers', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: jsonb('name').notNull().$type<LocalizedField>(),
  slug: text('slug').notNull(),
  country: text('country').notNull(),
  rating: integer('rating').notNull().default(0),
  logoUrl: text('logo_url'),
  verified: boolean('verified').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Seller = typeof sellers.$inferSelect;
export type NewSeller = typeof sellers.$inferInsert;
