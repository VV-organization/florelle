import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { MediaPhoto } from './storefront';
import type { LocalizedField } from './types';

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, {
    onDelete: 'set null',
  }),
  name: jsonb('name').notNull().$type<LocalizedField>(),
  slug: text('slug').notNull().unique(),
  imageUrl: text('image_url'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const products = pgTable('products', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: jsonb('name').notNull().$type<LocalizedField>(),
  slug: text('slug').notNull().unique(),
  species: text('species').notNull(),
  color: text('color').notNull(),
  stemLengthCm: integer('stem_length_cm'),
  headSize: text('head_size'),
  imageUrl: text('image_url').notNull(),
  photo: jsonb('photo').$type<MediaPhoto>(),
  description: jsonb('description').$type<LocalizedField>(),
  categoryId: uuid('category_id').references(() => categories.id, {
    onDelete: 'set null',
  }),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
