import { sql } from 'drizzle-orm';
import {
  check,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['buyer', 'admin']);
export const userStatusEnum = pgEnum('user_status', [
  'pending',
  'active',
  'suspended',
]);
export const customerTypeEnum = pgEnum('customer_type', [
  'individual',
  'legal_entity',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    customerType: customerTypeEnum('customer_type')
      .notNull()
      .default('legal_entity'),
    name: text('name'),
    companyName: text('company_name'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    phone: text('phone'),
    balanceUsd: numeric('balance_usd', { precision: 12, scale: 2 })
      .notNull()
      .default('0.00'),
    role: userRoleEnum('role').notNull().default('buyer'),
    status: userStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    customerTypeFieldsChk: check(
      'users_customer_type_fields_chk',
      sql`(
        (${table.customerType} = 'legal_entity'
         AND NULLIF(BTRIM(${table.companyName}), '') IS NOT NULL)
        OR
        (${table.customerType} = 'individual'
         AND (NULLIF(BTRIM(${table.name}), '') IS NOT NULL
              OR (${table.firstName} IS NOT NULL AND ${table.lastName} IS NOT NULL)))
      )`,
    ),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
