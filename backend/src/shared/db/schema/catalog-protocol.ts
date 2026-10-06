import { sql } from 'drizzle-orm';
import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const catalogProtocolOperationState = pgEnum(
  'catalog_protocol_operation_state',
  ['in_progress', 'completed', 'failed'],
);

export const catalogProtocolOperations = pgTable(
  'catalog_protocol_operations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    siteKey: varchar('site_key', { length: 128 }).notNull(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    requestFingerprint: varchar('request_fingerprint', { length: 64 }).notNull(),
    actorId: varchar('actor_id', { length: 128 }).notNull(),
    requestId: uuid('request_id').notNull(),
    method: varchar('method', { length: 10 }).notNull(),
    path: text('path').notNull(),
    state: catalogProtocolOperationState('state').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    idempotencyIdx: uniqueIndex('catalog_protocol_operations_site_idem_idx').on(
      table.siteKey,
      table.idempotencyKey,
    ),
    requestIdx: uniqueIndex('catalog_protocol_operations_site_request_idx').on(
      table.siteKey,
      table.requestId,
    ),
  }),
);

export type CatalogProtocolOperation =
  typeof catalogProtocolOperations.$inferSelect;
