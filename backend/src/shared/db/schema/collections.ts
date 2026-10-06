import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { LocalizedField } from './types';
import { listings } from './listings';

export const collectionTypeEnum = pgEnum('collection_type', [
  'promo',
  'seasonal',
  'editorial',
]);

export const collections = pgTable('collections', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: jsonb('name').notNull().$type<LocalizedField>(),
  slug: text('slug').notNull().unique(),
  type: collectionTypeEnum('type').notNull(),
  imageUrl: text('image_url'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const collectionItems = pgTable(
  'collection_items',
  {
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.collectionId, t.listingId] }),
  }),
);

export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;
export type CollectionItem = typeof collectionItems.$inferSelect;
export type NewCollectionItem = typeof collectionItems.$inferInsert;
