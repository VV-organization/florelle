import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for drizzle-kit');
}

export default defineConfig({
  schema: './src/shared/db/schema/index.ts',
  out: './src/shared/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
