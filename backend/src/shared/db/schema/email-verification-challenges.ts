import { sql } from 'drizzle-orm';
import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const emailVerificationChallenges = pgTable(
  'email_verification_challenges',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    registrationPayload: jsonb('registration_payload').$type<{passwordHash:string;customerType:'individual'|'legal_entity';name:string|null;firstName:string|null;lastName:string|null;companyName:string|null;phone:string|null}>(),
    attemptCount: integer('attempt_count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    resendAvailableAt: timestamp('resend_available_at', {
      withTimezone: true,
    }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type EmailVerificationChallenge =
  typeof emailVerificationChallenges.$inferSelect;
export type NewEmailVerificationChallenge =
  typeof emailVerificationChallenges.$inferInsert;
