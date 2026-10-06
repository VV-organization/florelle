/**
 * Standalone migration script for production.
 * Uses drizzle-orm/postgres-js/migrator (production dependency)
 * instead of drizzle-kit (dev dependency).
 *
 * Usage: node migrate.mjs
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });
const db = drizzle(sql);

try {
  await migrate(db, { migrationsFolder: './src/shared/db/migrations' });
  console.log('Migrations applied successfully');
} catch (err) {
  console.error('Migration failed:', err);
  process.exit(1);
} finally {
  await sql.end();
}
