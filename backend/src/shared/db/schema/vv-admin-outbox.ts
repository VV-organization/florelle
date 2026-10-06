import { sql } from 'drizzle-orm';
import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const vvAdminOutbox = pgTable('vv_admin_outbox', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  eventId: text('event_id').notNull().unique(),
  eventType: text('event_type').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('pending'),
  attemptCount: integer('attempt_count').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  dispatchLeaseExpiresAt: timestamp('dispatch_lease_expires_at', {
    withTimezone: true,
  }),
  lastError: text('last_error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const vvAdminOutboxAttempts = pgTable(
  'vv_admin_outbox_attempts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    outboxId: uuid('outbox_id')
      .notNull()
      .references(() => vvAdminOutbox.id, { onDelete: 'cascade' }),
    attemptNumber: integer('attempt_number').notNull(),
    status: text('status').notNull(),
    httpStatus: integer('http_status'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => ({
    outboxAttemptNumber: uniqueIndex('vv_admin_outbox_attempts_outbox_attempt_number')
      .on(table.outboxId, table.attemptNumber),
  }),
);

export type VvAdminOutboxRow = typeof vvAdminOutbox.$inferSelect;
