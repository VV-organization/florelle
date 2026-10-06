# Auth Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working authentication module for the B2B flowers backend covering `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, and an `authenticate` Fastify decorator — fully unit-tested against mocked DB and Redis.

**Architecture:** Single `AuthService` class (constructor-injected `Database`, `RedisClient`, and JWT config) exposing five public methods. Router is a thin Fastify plugin that maps HTTP to service calls and handles cookies. The middleware is a factory that closes over an `AuthService` instance and is wired up in `app.ts`. Unit tests use hand-rolled chainable Drizzle mocks and real `jose` (no crypto mocking). All spec decisions — single-session, no refresh rotation, `active`-on-register, same-origin cookies — are locked in this plan.

**Tech Stack:** Fastify 4, `fastify-type-provider-zod`, Drizzle ORM + `postgres.js`, `ioredis`, `jose` (HS256), `bcrypt` (cost 12), Zod 3, Vitest.

**Spec:** [`backend/docs/superpowers/specs/2026-04-10-auth-module-design.md`](../specs/2026-04-10-auth-module-design.md)

**Assumed workdir for all commands:** `flowers/backend/`.

---

## File structure

| File | Action | Purpose |
|---|---|---|
| `package.json` | Modify | Add `fastify-type-provider-zod` |
| `vitest.config.ts` | Create | Test env vars so `env.ts` validation passes even if indirectly imported |
| `src/shared/db/schema/users.ts` | Modify | Remove `inviteCodes` table, remove `users.inviteCodeUsed`, change `status` default to `'active'` |
| `src/shared/db/migrations/0000_*.sql` | Create | First Drizzle migration (auto-generated) |
| `src/modules/auth/auth.errors.ts` | Create | Typed error subclasses of `AppError` |
| `src/modules/auth/auth.schema.ts` | Create | Zod schemas + inferred types for request/response bodies |
| `src/modules/auth/auth.service.ts` | Create | `AuthService` class — register/login/refresh/logout/verifyAccessToken |
| `src/modules/auth/__tests__/auth.service.test.ts` | Create | 20 unit tests (per spec section 8) |
| `src/modules/auth/auth.router.ts` | Modify (currently a stub) | 4 Fastify routes with Zod type provider |
| `src/shared/middleware/auth.middleware.ts` | Modify (currently a stub) | Export `createAuthenticateHandler(authService)` factory |
| `src/app.ts` | Modify | Register Zod type provider, `app.db` / `app.redis` / `app.authenticate` decorators, instantiate `AuthService`, mount auth router |

---

## Task 1: Install dependency and add Vitest config

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

**Prerequisites:** none. This is the first task after cloning.

- [ ] **Step 1: Install the missing dependency**

Run:
```bash
pnpm install
pnpm add fastify-type-provider-zod@^2.1.0
```

Expected: dependency added to `dependencies` in `package.json`, `pnpm-lock.yaml` created/updated. **Important version note:** version 2.x is the Fastify 4 compatible line of this package; 3.x requires Fastify 5. Do NOT install 3.x while the project is on Fastify 4.

- [ ] **Step 2: Create `vitest.config.ts` with test env vars**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      HOST: '0.0.0.0',
      DATABASE_URL: 'postgresql://test:test@localhost:5434/test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters-long',
      JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters-long',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL: '30d',
      RESEND_API_KEY: 'test-key',
      EMAIL_FROM: 'test@example.com',
      FX_API_KEY: 'test-fx',
      FX_BASE_CURRENCY: 'USD',
      FX_CACHE_TTL_SECONDS: '3600',
      PLATFORM_COMMISSION_PERCENT: '12',
    },
  },
});
```

Rationale: any indirect import of `src/shared/env.ts` during tests will find these values and pass Zod validation. This is a defense-in-depth measure — the service uses `type`-only imports for `Database`/`RedisClient`, so `env.ts` should not actually load during unit tests, but this guarantees it works if the import graph changes.

- [ ] **Step 3: Verify vitest picks up the config**

Run:
```bash
pnpm test
```
Expected: vitest loads the config and reports "No test files found" (or equivalent). Vitest v2.x exits with a non-zero code when no tests are found — that is normal for this step, not a failure. What matters is that there are NO TypeScript / config-parsing errors.

- [ ] **Step 4: Commit**

```bash
cd ..
git add backend/package.json backend/pnpm-lock.yaml backend/vitest.config.ts
git commit -m "chore(backend): add fastify-type-provider-zod and vitest config"
cd backend
```

---

## Task 2: Remove invite codes from users schema

**Files:**
- Modify: `src/shared/db/schema/users.ts`
- Modify: `src/shared/db/schema/index.ts`

- [ ] **Step 1: Rewrite `src/shared/db/schema/users.ts`**

Replace the entire file content with:
```ts
import { sql } from 'drizzle-orm';
import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['buyer', 'admin']);
export const userStatusEnum = pgEnum('user_status', [
  'pending',
  'active',
  'suspended',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  companyName: text('company_name').notNull(),
  role: userRoleEnum('role').notNull().default('buyer'),
  status: userStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

Changes vs previous version: removed the `inviteCodes` table, removed `users.inviteCodeUsed`, changed `status` default from `'pending'` to `'active'`, removed `inviteCodes` from imports (`integer` no longer needed in users.ts after this change).

- [ ] **Step 2: Verify `src/shared/db/schema/index.ts` doesn't re-export invite types**

Open `src/shared/db/schema/index.ts`. It should already re-export `./users.js` without naming `InviteCode` specifically. If `users.ts` no longer exports `InviteCode`/`NewInviteCode`, the star export in `index.ts` automatically drops them. No change needed.

- [ ] **Step 3: Typecheck passes**

Run:
```bash
pnpm typecheck
```
Expected: no errors. Any residual usage of `inviteCodes` would be caught here. If there are errors, fix the offending imports (there should be none in scaffold-only state).

- [ ] **Step 4: Commit**

```bash
cd ..
git add backend/src/shared/db/schema/users.ts
git commit -m "refactor(backend): remove invite codes from users schema

Applies spec decision: open buyer registration. Drops the inviteCodes
table, users.invite_code_used column, and changes the default user
status from 'pending' to 'active'."
cd backend
```

---

## Task 3: Generate and apply the initial Drizzle migration

**Files:**
- Create: `src/shared/db/migrations/0000_*.sql` (auto-generated)
- Create: `src/shared/db/migrations/meta/_journal.json`, `0000_snapshot.json`

**Prerequisites:** Docker must be running.

- [ ] **Step 1: Start Postgres and Redis**

Run:
```bash
docker compose up -d
docker compose ps
```
Expected: both `flowers-postgres` and `flowers-redis` show `healthy`. Wait up to 10s if not yet healthy.

- [ ] **Step 2: Create `.env` from the example**

Run:
```bash
cp .env.example .env
```

Then edit `.env` and replace the two JWT secrets with any strings of at least 32 characters. Example values that satisfy the Zod check (do NOT use these in production):
```
JWT_ACCESS_SECRET=dev-access-secret-at-least-32-characters-long
JWT_REFRESH_SECRET=dev-refresh-secret-at-least-32-characters-long
```
Also set `RESEND_API_KEY` to any non-empty value (e.g. `re_dev_placeholder`) and `FX_API_KEY` to any non-empty value — neither is used by auth, but `env.ts` requires them to be present for migrations via `tsx`.

- [ ] **Step 3: Generate the initial migration**

Run:
```bash
pnpm db:generate
```
Expected: drizzle-kit creates `src/shared/db/migrations/0000_<random_name>.sql` with `CREATE TABLE` statements for all domains (users, sellers, products, listings, collections, carts, orders, payments, exchange_rates) and all enums. No `invite_codes` table should appear in the SQL.

- [ ] **Step 4: Apply the migration**

Run:
```bash
pnpm db:migrate
```
Expected: "migrations applied" or similar. No errors.

- [ ] **Step 5: Sanity-check via psql inside the container**

Run:
```bash
docker exec -it flowers-postgres psql -U flowers -d flowers_db -c "\dt"
```
Expected: list of tables includes `users`, `sellers`, `products`, `listings`, `collections`, `collection_items`, `carts`, `cart_items`, `orders`, `order_items`, `payments`, `exchange_rates`. There is NO `invite_codes` table.

- [ ] **Step 6: Commit the generated migration files**

```bash
cd ..
git add backend/src/shared/db/migrations/
git commit -m "feat(backend): initial Drizzle migration

Creates all MVP tables from schema files. No invite_codes table —
this migration reflects the open-registration decision."
cd backend
```

---

## Task 4: Create `auth.errors.ts`

**Files:**
- Create: `src/modules/auth/auth.errors.ts`

- [ ] **Step 1: Create the error classes file**

Create `src/modules/auth/auth.errors.ts`:
```ts
import { AppError } from '../../shared/middleware/error.middleware.js';

export class EmailAlreadyRegisteredError extends AppError {
  constructor() {
    super(409, 'EMAIL_ALREADY_REGISTERED', 'Email is already registered');
  }
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    super(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
}

export class AccountSuspendedError extends AppError {
  constructor() {
    super(403, 'ACCOUNT_SUSPENDED', 'Account is suspended');
  }
}

export class InvalidRefreshTokenError extends AppError {
  constructor() {
    super(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
  }
}
```

Note: `InvalidCredentialsError` has a deliberately generic message — no enumeration oracle (spec section 4).

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: pass.

- [ ] **Step 3: Commit**

```bash
cd ..
git add backend/src/modules/auth/auth.errors.ts
git commit -m "feat(backend/auth): typed errors for auth module"
cd backend
```

---

## Task 5: Create `auth.schema.ts`

**Files:**
- Create: `src/modules/auth/auth.schema.ts`

- [ ] **Step 1: Create the schema file**

Create `src/modules/auth/auth.schema.ts`:
```ts
import { z } from 'zod';

/**
 * Request schemas
 */
export const registerBodySchema = z.object({
  email: z.string().email().toLowerCase().max(320),
  password: z.string().min(8).max(128),
  companyName: z.string().trim().min(2).max(200),
});

export const loginBodySchema = z.object({
  email: z.string().email().toLowerCase().max(320),
  password: z.string().min(1).max(128),
});

/**
 * Public-facing user shape (no password hash).
 */
export const publicUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  companyName: z.string(),
  role: z.enum(['buyer', 'admin']),
  status: z.enum(['pending', 'active', 'suspended']),
  createdAt: z.string().datetime(),
});

/**
 * Success response for /auth/register and /auth/login.
 */
export const authSuccessResponseSchema = z.object({
  user: publicUserSchema,
  accessToken: z.string(),
});

/**
 * Success response for /auth/refresh.
 */
export const refreshSuccessResponseSchema = z.object({
  accessToken: z.string(),
});

/**
 * Inferred TypeScript types.
 */
export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;
export type AuthSuccessResponse = z.infer<typeof authSuccessResponseSchema>;
export type RefreshSuccessResponse = z.infer<typeof refreshSuccessResponseSchema>;
```

Notes:
- `email` is lowercased at parse time — we never store mixed-case email.
- `login` password min is 1 (not 8) — we do not reveal our register-time policy on login; a short password simply fails comparison.
- `publicUserSchema.status` includes all three enum values even though register always produces `active` — the schema describes reality, not current flow.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: pass.

- [ ] **Step 3: Commit**

```bash
cd ..
git add backend/src/modules/auth/auth.schema.ts
git commit -m "feat(backend/auth): Zod schemas for auth requests and responses"
cd backend
```

---

## Task 6: `AuthService` scaffolding and test file bootstrap

**Files:**
- Create: `src/modules/auth/auth.service.ts`
- Create: `src/modules/auth/__tests__/auth.service.test.ts`

- [ ] **Step 1: Create `auth.service.ts` with the class skeleton**

Create `src/modules/auth/auth.service.ts`:
```ts
import type { Database } from '../../shared/db/client.js';
import type { RedisClient } from '../../shared/redis/client.js';
import type { PublicUser, RegisterBody, LoginBody } from './auth.schema.js';

export type AuthServiceConfig = {
  accessSecret: Uint8Array;
  refreshSecret: Uint8Array;
  accessTtl: string;   // e.g. '15m'
  refreshTtl: string;  // e.g. '30d'
  refreshTtlSeconds: number; // e.g. 2592000 (used for Redis EX)
};

export type AuthSuccess = {
  user: PublicUser;
  tokens: { accessToken: string; refreshToken: string };
};

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly redis: RedisClient,
    private readonly config: AuthServiceConfig,
  ) {}

  async register(_input: RegisterBody): Promise<AuthSuccess> {
    throw new Error('not implemented');
  }

  async login(_input: LoginBody): Promise<AuthSuccess> {
    throw new Error('not implemented');
  }

  async refresh(_refreshToken: string | undefined): Promise<{ accessToken: string }> {
    throw new Error('not implemented');
  }

  async logout(_refreshToken: string | undefined): Promise<void> {
    throw new Error('not implemented');
  }

  async verifyAccessToken(
    _token: string,
  ): Promise<{ userId: string; role: 'buyer' | 'admin' }> {
    throw new Error('not implemented');
  }
}
```

- [ ] **Step 2: Create the test file with mock factories and shared setup**

Create `src/modules/auth/__tests__/auth.service.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuthService, type AuthServiceConfig } from '../auth.service.js';
import type { Database } from '../../../shared/db/client.js';
import type { RedisClient } from '../../../shared/redis/client.js';

/**
 * Build a chainable Drizzle mock whose terminal methods can be overridden
 * per test.
 */
function createDbMock() {
  const db = {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };
  return db as unknown as Database & typeof db;
}

function createRedisMock() {
  const redis = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  };
  return redis as unknown as RedisClient & typeof redis;
}

const testConfig: AuthServiceConfig = {
  accessSecret: new TextEncoder().encode(
    'test-access-secret-at-least-32-characters-long',
  ),
  refreshSecret: new TextEncoder().encode(
    'test-refresh-secret-at-least-32-characters-long',
  ),
  accessTtl: '15m',
  refreshTtl: '30d',
  refreshTtlSeconds: 60 * 60 * 24 * 30,
};

describe('AuthService', () => {
  let db: ReturnType<typeof createDbMock>;
  let redis: ReturnType<typeof createRedisMock>;
  let service: AuthService;

  beforeEach(() => {
    db = createDbMock();
    redis = createRedisMock();
    service = new AuthService(db, redis, testConfig);
  });

  it('instantiates', () => {
    expect(service).toBeInstanceOf(AuthService);
  });
});
```

- [ ] **Step 3: Run the single instantiation test**

```bash
pnpm test
```
Expected: 1 test passes (the `instantiates` smoke test). This confirms the whole test harness loads without touching real DB/Redis/env.

- [ ] **Step 4: Commit**

```bash
cd ..
git add backend/src/modules/auth/auth.service.ts backend/src/modules/auth/__tests__/auth.service.test.ts
git commit -m "feat(backend/auth): AuthService skeleton and test harness"
cd backend
```

---

## Task 7: `AuthService.register()` — TDD

**Files:**
- Modify: `src/modules/auth/auth.service.ts`
- Modify: `src/modules/auth/__tests__/auth.service.test.ts`

The goal: drive out the full implementation of `register()` with tests for the 5 spec cases (T1–T5 in spec section 8).

- [ ] **Step 1: Add the first failing test — password is hashed with cost 12**

Inside the `describe('AuthService', ...)` block in the test file, add (before the closing `})`):
```ts
describe('register', () => {
  const validInput = {
    email: 'buyer@example.com',
    password: 'correct-horse-battery',
    companyName: 'Acme Flowers',
  };

  const dbUser = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'buyer@example.com',
    passwordHash: 'hashed-value',
    companyName: 'Acme Flowers',
    role: 'buyer' as const,
    status: 'active' as const,
    createdAt: new Date('2026-04-10T10:00:00.000Z'),
    updatedAt: new Date('2026-04-10T10:00:00.000Z'),
  };

  it('hashes the password with bcrypt cost factor 12', async () => {
    const bcrypt = await import('bcrypt');
    const hashSpy = vi
      .spyOn(bcrypt.default, 'hash')
      .mockResolvedValue('hashed-value' as never);
    db.returning.mockResolvedValue([dbUser]);

    await service.register(validInput);

    expect(hashSpy).toHaveBeenCalledWith('correct-horse-battery', 12);
    hashSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm test
```
Expected: FAIL with "not implemented" error from `register()`.

- [ ] **Step 3: Implement the minimal version of `register()`**

In `src/modules/auth/auth.service.ts`, add these imports at the top (only what Task 7 actually uses — later tasks will extend the import list):
```ts
import bcrypt from 'bcrypt';
import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { users } from '../../shared/db/schema/users.js';
import { EmailAlreadyRegisteredError } from './auth.errors.js';
```

Then replace the `register` method body:
```ts
async register(input: RegisterBody): Promise<AuthSuccess> {
  const passwordHash = await bcrypt.hash(input.password, 12);

  let inserted: typeof users.$inferSelect;
  try {
    const result = await this.db
      .insert(users)
      .values({
        email: input.email,
        passwordHash,
        companyName: input.companyName,
      })
      .returning();
    inserted = result[0]!;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new EmailAlreadyRegisteredError();
    }
    throw err;
  }

  const tokens = await this.issueTokens(inserted.id, inserted.role);
  await this.persistRefreshSession(inserted.id, tokens.refreshJti);

  return {
    user: toPublicUser(inserted),
    tokens: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
  };
}
```

Add these helpers at the bottom of the class (still private methods):
```ts
private async issueTokens(
  userId: string,
  role: 'buyer' | 'admin',
): Promise<{ accessToken: string; refreshToken: string; refreshJti: string }> {
  const accessToken = await new SignJWT({ role, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(this.config.accessTtl)
    .sign(this.config.accessSecret);

  const jti = randomUUID();
  const refreshToken = await new SignJWT({ type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(this.config.refreshTtl)
    .sign(this.config.refreshSecret);

  return { accessToken, refreshToken, refreshJti: jti };
}

private async persistRefreshSession(userId: string, jti: string): Promise<void> {
  await this.redis.set(
    `refresh:${userId}`,
    jti,
    'EX',
    this.config.refreshTtlSeconds,
  );
}
```

And add these module-level helpers (outside the class, at the bottom of the file):
```ts
function toPublicUser(row: typeof users.$inferSelect): PublicUser {
  return {
    id: row.id,
    email: row.email,
    companyName: row.companyName,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === '23505'
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
pnpm test
```
Expected: `register hashes the password with bcrypt cost factor 12` PASSES. If bcrypt is ESM-mocked incorrectly, you may need to switch to `vi.mock('bcrypt', ...)` at the top of the test file:
```ts
vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn(),
    compare: vi.fn(),
    hashSync: vi.fn(() => 'fake-hash'),
  },
}));
```
And change the test to call `vi.mocked(bcrypt.default.hash).mockResolvedValue(...)`. Try the simpler `vi.spyOn` approach first; fall back to `vi.mock` if bcrypt's default export wiring fights you.

- [ ] **Step 5: Add test — rejects existing email (unique violation)**

Add inside the `describe('register')` block:
```ts
it('throws EmailAlreadyRegisteredError when insert hits unique constraint', async () => {
  const bcrypt = await import('bcrypt');
  vi.spyOn(bcrypt.default, 'hash').mockResolvedValue('hashed-value' as never);

  const uniqueErr = Object.assign(new Error('unique'), { code: '23505' });
  db.returning.mockRejectedValue(uniqueErr);

  await expect(service.register(validInput)).rejects.toThrow(
    'Email is already registered',
  );
});
```

- [ ] **Step 6: Run and verify this test passes without new implementation**

```bash
pnpm test
```
Expected: both register tests pass. The implementation from step 3 already handles this via `isUniqueViolation`.

- [ ] **Step 7: Add test — creates user with role `buyer` and status `active`**

```ts
it('creates user with role=buyer and status=active', async () => {
  const bcrypt = await import('bcrypt');
  vi.spyOn(bcrypt.default, 'hash').mockResolvedValue('hashed-value' as never);
  db.returning.mockResolvedValue([dbUser]);

  const result = await service.register(validInput);

  expect(db.insert).toHaveBeenCalled();
  expect(db.values).toHaveBeenCalledWith(
    expect.objectContaining({
      email: 'buyer@example.com',
      passwordHash: 'hashed-value',
      companyName: 'Acme Flowers',
    }),
  );
  expect(result.user.role).toBe('buyer');
  expect(result.user.status).toBe('active');
});
```

- [ ] **Step 8: Run — should pass**

```bash
pnpm test
```
Expected: PASS. The DB default handles role/status; we do not override them in `register()`.

- [ ] **Step 9: Add test — issues tokens and stores the jti in Redis with correct TTL**

```ts
it('issues a token pair and stores refresh jti in Redis with 30-day TTL', async () => {
  const bcrypt = await import('bcrypt');
  vi.spyOn(bcrypt.default, 'hash').mockResolvedValue('hashed-value' as never);
  db.returning.mockResolvedValue([dbUser]);

  const result = await service.register(validInput);

  expect(result.tokens.accessToken).toMatch(/^eyJ/); // JWT base64
  expect(result.tokens.refreshToken).toMatch(/^eyJ/);
  expect(redis.set).toHaveBeenCalledWith(
    `refresh:${dbUser.id}`,
    expect.any(String),
    'EX',
    60 * 60 * 24 * 30,
  );
});
```

- [ ] **Step 10: Run — should pass**

```bash
pnpm test
```
Expected: PASS.

- [ ] **Step 11: Add test — response omits passwordHash**

```ts
it('returned user does not expose passwordHash', async () => {
  const bcrypt = await import('bcrypt');
  vi.spyOn(bcrypt.default, 'hash').mockResolvedValue('hashed-value' as never);
  db.returning.mockResolvedValue([dbUser]);

  const result = await service.register(validInput);

  expect(result.user).not.toHaveProperty('passwordHash');
  expect(Object.keys(result.user).sort()).toEqual(
    ['companyName', 'createdAt', 'email', 'id', 'role', 'status'].sort(),
  );
});
```

- [ ] **Step 12: Run — should pass**

```bash
pnpm test
```
Expected: PASS. `toPublicUser()` already excludes passwordHash.

- [ ] **Step 13: Commit**

```bash
cd ..
git add backend/src/modules/auth/auth.service.ts backend/src/modules/auth/__tests__/auth.service.test.ts
git commit -m "feat(backend/auth): register() with bcrypt, JWT, Redis session

Implements AuthService.register covering 5 spec test cases: password
hashing with cost 12, unique violation → 409, role/status defaults,
token pair + Redis TTL, and passwordHash omission in response."
cd backend
```

---

## Task 8: `AuthService.login()` — TDD

**Files:**
- Modify: `src/modules/auth/auth.service.ts`
- Modify: `src/modules/auth/__tests__/auth.service.test.ts`

Spec test cases: T6 (happy path), T7 (unknown email + timing equalization), T8 (wrong password), T9 (suspended), T10 (overwrites Redis).

- [ ] **Step 1: Add first failing test — happy path**

Add new `describe` block inside `describe('AuthService')`:
```ts
describe('login', () => {
  const validInput = {
    email: 'buyer@example.com',
    password: 'correct-horse-battery',
  };

  const dbUser = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'buyer@example.com',
    passwordHash: 'stored-hash',
    companyName: 'Acme Flowers',
    role: 'buyer' as const,
    status: 'active' as const,
    createdAt: new Date('2026-04-10T10:00:00.000Z'),
    updatedAt: new Date('2026-04-10T10:00:00.000Z'),
  };

  it('happy path returns token pair and public user', async () => {
    const bcrypt = await import('bcrypt');
    vi.spyOn(bcrypt.default, 'compare').mockResolvedValue(true as never);
    db.limit.mockResolvedValue([dbUser]);

    const result = await service.login(validInput);

    expect(result.user.id).toBe(dbUser.id);
    expect(result.tokens.accessToken).toMatch(/^eyJ/);
    expect(result.tokens.refreshToken).toMatch(/^eyJ/);
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test
```
Expected: FAIL with "not implemented".

- [ ] **Step 3: Implement `login()`**

In `auth.service.ts`, extend the imports to include the ones Task 8 needs:
```ts
import { eq } from 'drizzle-orm';
import {
  AccountSuspendedError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
} from './auth.errors.js';
```
Replace the existing import of `EmailAlreadyRegisteredError` with the grouped block above (drop the single-line import from Task 7 and use this one instead).

Then add a module-level fake hash constant near the top (after imports):
```ts
// Constant-time equalization for /auth/login: run bcrypt.compare even when
// the email is not found, so response time does not leak user existence.
const FAKE_PASSWORD_HASH = bcrypt.hashSync('unused-placeholder', 12);
```

Replace the `login` method body:
```ts
async login(input: LoginBody): Promise<AuthSuccess> {
  const rows = await this.db
    .select()
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);

  const user = rows[0];
  const hashToCompare = user?.passwordHash ?? FAKE_PASSWORD_HASH;
  const passwordOk = await bcrypt.compare(input.password, hashToCompare);

  if (!user || !passwordOk) {
    throw new InvalidCredentialsError();
  }
  if (user.status === 'suspended') {
    throw new AccountSuspendedError();
  }

  const tokens = await this.issueTokens(user.id, user.role);
  await this.persistRefreshSession(user.id, tokens.refreshJti);

  return {
    user: toPublicUser(user),
    tokens: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
  };
}
```

- [ ] **Step 4: Run — should pass**

```bash
pnpm test
```
Expected: PASS for the happy path test.

- [ ] **Step 5: Add test — unknown email throws, but bcrypt.compare is still called**

```ts
it('throws InvalidCredentialsError for unknown email AND still calls bcrypt.compare', async () => {
  const bcrypt = await import('bcrypt');
  const compareSpy = vi
    .spyOn(bcrypt.default, 'compare')
    .mockResolvedValue(false as never);
  db.limit.mockResolvedValue([]); // no user

  await expect(service.login(validInput)).rejects.toThrow(
    'Invalid email or password',
  );
  expect(compareSpy).toHaveBeenCalledTimes(1); // timing equalization
});
```

- [ ] **Step 6: Run — should pass**

```bash
pnpm test
```
Expected: PASS. The fallback to `FAKE_PASSWORD_HASH` ensures `bcrypt.compare` runs.

- [ ] **Step 7: Add test — wrong password throws**

```ts
it('throws InvalidCredentialsError on wrong password', async () => {
  const bcrypt = await import('bcrypt');
  vi.spyOn(bcrypt.default, 'compare').mockResolvedValue(false as never);
  db.limit.mockResolvedValue([dbUser]);

  await expect(service.login(validInput)).rejects.toThrow(
    'Invalid email or password',
  );
});
```

- [ ] **Step 8: Run — should pass**

```bash
pnpm test
```
Expected: PASS.

- [ ] **Step 9: Add test — suspended account throws `AccountSuspendedError`**

```ts
it('throws AccountSuspendedError when user is suspended', async () => {
  const bcrypt = await import('bcrypt');
  vi.spyOn(bcrypt.default, 'compare').mockResolvedValue(true as never);
  db.limit.mockResolvedValue([{ ...dbUser, status: 'suspended' }]);

  await expect(service.login(validInput)).rejects.toThrow(
    'Account is suspended',
  );
});
```

- [ ] **Step 10: Run — should pass**

```bash
pnpm test
```
Expected: PASS.

- [ ] **Step 11: Add test — login overwrites the existing Redis refresh key**

```ts
it('login overwrites the existing refresh key (single-session)', async () => {
  const bcrypt = await import('bcrypt');
  vi.spyOn(bcrypt.default, 'compare').mockResolvedValue(true as never);
  db.limit.mockResolvedValue([dbUser]);

  await service.login(validInput);

  expect(redis.set).toHaveBeenCalledWith(
    `refresh:${dbUser.id}`,
    expect.any(String),
    'EX',
    60 * 60 * 24 * 30,
  );
  expect(redis.set).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 12: Run — should pass**

```bash
pnpm test
```
Expected: PASS. `redis.set` without a NX flag always overwrites.

- [ ] **Step 13: Commit**

```bash
cd ..
git add backend/src/modules/auth/auth.service.ts backend/src/modules/auth/__tests__/auth.service.test.ts
git commit -m "feat(backend/auth): login() with timing-equalized bcrypt compare

Implements AuthService.login covering 5 spec test cases: happy path,
unknown email (still runs bcrypt.compare to avoid timing oracle),
wrong password, suspended account, and single-session Redis overwrite."
cd backend
```

---

## Task 9: `AuthService.refresh()` — TDD

**Files:**
- Modify: `src/modules/auth/auth.service.ts`
- Modify: `src/modules/auth/__tests__/auth.service.test.ts`

Spec test cases: T11 (happy path), T12 (missing cookie), T13 (invalid JWT), T14 (wrong type), T15 (jti mismatch), T16 (suspended).

- [ ] **Step 1: Add helper at top of the test file to forge a valid refresh token**

Inside the `describe('AuthService')` block but before nested describes, add:
```ts
async function forgeRefreshToken(options: {
  sub: string;
  jti: string;
  secret?: Uint8Array;
  expiresIn?: string;
  type?: string;
}): Promise<string> {
  const { SignJWT } = await import('jose');
  return new SignJWT({ type: options.type ?? 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(options.sub)
    .setJti(options.jti)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '30d')
    .sign(options.secret ?? testConfig.refreshSecret);
}
```

- [ ] **Step 2: Add happy path test**

```ts
describe('refresh', () => {
  const userId = '00000000-0000-0000-0000-000000000001';
  const jti = '11111111-1111-1111-1111-111111111111';
  const activeUser = {
    id: userId,
    role: 'buyer' as const,
    status: 'active' as const,
  };

  it('happy path: returns new access token without touching cookie or Redis', async () => {
    const token = await forgeRefreshToken({ sub: userId, jti });
    redis.get.mockResolvedValue(jti);
    db.limit.mockResolvedValue([activeUser]);

    const result = await service.refresh(token);

    expect(result.accessToken).toMatch(/^eyJ/);
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run — should fail**

```bash
pnpm test
```
Expected: FAIL with "not implemented".

- [ ] **Step 4: Implement `refresh()`**

In `auth.service.ts`, extend the imports with what Task 9 needs:
```ts
import { SignJWT, jwtVerify } from 'jose';  // replace the existing 'jose' import line
import {
  AccountSuspendedError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
} from './auth.errors.js';  // replace the existing auth.errors import block
```

Replace the `refresh` method body:
```ts
async refresh(refreshToken: string | undefined): Promise<{ accessToken: string }> {
  const { sub, role } = await this.verifyRefreshTokenAndSession(refreshToken);

  const accessToken = await new SignJWT({ role, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(this.config.accessTtl)
    .sign(this.config.accessSecret);

  return { accessToken };
}
```

Add the private helper `verifyRefreshTokenAndSession` below `persistRefreshSession`:
```ts
private async verifyRefreshTokenAndSession(
  token: string | undefined,
): Promise<{ sub: string; role: 'buyer' | 'admin' }> {
  if (!token) {
    throw new InvalidRefreshTokenError();
  }

  let payload: { sub?: string; jti?: string; type?: string };
  try {
    const verified = await jwtVerify(token, this.config.refreshSecret);
    payload = verified.payload as typeof payload;
  } catch {
    throw new InvalidRefreshTokenError();
  }

  if (payload.type !== 'refresh' || !payload.sub || !payload.jti) {
    throw new InvalidRefreshTokenError();
  }

  const storedJti = await this.redis.get(`refresh:${payload.sub}`);
  if (!storedJti || storedJti !== payload.jti) {
    throw new InvalidRefreshTokenError();
  }

  const rows = await this.db
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .where(eq(users.id, payload.sub))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new InvalidRefreshTokenError();
  }
  if (row.status === 'suspended') {
    throw new AccountSuspendedError();
  }

  return { sub: row.id, role: row.role };
}
```

- [ ] **Step 5: Run — happy path should pass**

```bash
pnpm test
```
Expected: PASS.

- [ ] **Step 6: Add test — missing cookie**

```ts
it('throws InvalidRefreshTokenError when token is undefined', async () => {
  await expect(service.refresh(undefined)).rejects.toThrow(
    'Refresh token is invalid or expired',
  );
});
```

- [ ] **Step 7: Run — should pass**

```bash
pnpm test
```
Expected: PASS.

- [ ] **Step 8: Add test — malformed / wrong-signature JWT**

```ts
it('throws InvalidRefreshTokenError for a malformed JWT', async () => {
  await expect(service.refresh('not.a.jwt')).rejects.toThrow(
    'Refresh token is invalid or expired',
  );
});

it('throws InvalidRefreshTokenError for a JWT signed with wrong secret', async () => {
  const wrongSecret = new TextEncoder().encode(
    'different-secret-that-is-also-32-chars-long-enough',
  );
  const token = await forgeRefreshToken({
    sub: userId,
    jti,
    secret: wrongSecret,
  });

  await expect(service.refresh(token)).rejects.toThrow(
    'Refresh token is invalid or expired',
  );
});
```

- [ ] **Step 9: Run — should pass**

```bash
pnpm test
```
Expected: both PASS.

- [ ] **Step 10: Add test — wrong token type**

```ts
it('throws InvalidRefreshTokenError when payload.type is not "refresh"', async () => {
  const token = await forgeRefreshToken({ sub: userId, jti, type: 'access' });

  await expect(service.refresh(token)).rejects.toThrow(
    'Refresh token is invalid or expired',
  );
});
```

- [ ] **Step 11: Run — should pass**

```bash
pnpm test
```
Expected: PASS.

- [ ] **Step 12: Add test — jti mismatch (stale session)**

```ts
it('throws InvalidRefreshTokenError when Redis has a different jti', async () => {
  const token = await forgeRefreshToken({ sub: userId, jti });
  redis.get.mockResolvedValue('22222222-2222-2222-2222-222222222222'); // newer jti

  await expect(service.refresh(token)).rejects.toThrow(
    'Refresh token is invalid or expired',
  );
});

it('throws InvalidRefreshTokenError when Redis has no session at all', async () => {
  const token = await forgeRefreshToken({ sub: userId, jti });
  redis.get.mockResolvedValue(null);

  await expect(service.refresh(token)).rejects.toThrow(
    'Refresh token is invalid or expired',
  );
});
```

- [ ] **Step 13: Run — should pass**

```bash
pnpm test
```
Expected: both PASS.

- [ ] **Step 14: Add test — suspended user**

```ts
it('throws AccountSuspendedError when the user is suspended', async () => {
  const token = await forgeRefreshToken({ sub: userId, jti });
  redis.get.mockResolvedValue(jti);
  db.limit.mockResolvedValue([{ ...activeUser, status: 'suspended' }]);

  await expect(service.refresh(token)).rejects.toThrow(
    'Account is suspended',
  );
});
```

- [ ] **Step 15: Run — should pass**

```bash
pnpm test
```
Expected: PASS.

- [ ] **Step 16: Commit**

```bash
cd ..
git add backend/src/modules/auth/auth.service.ts backend/src/modules/auth/__tests__/auth.service.test.ts
git commit -m "feat(backend/auth): refresh() with 6-step verification

Implements AuthService.refresh covering 6 spec test cases: happy path,
missing cookie, malformed JWT, wrong-secret JWT, wrong type claim,
jti mismatch / no session, and suspended user."
cd backend
```

---

## Task 10: `AuthService.logout()` — TDD

**Files:**
- Modify: `src/modules/auth/auth.service.ts`
- Modify: `src/modules/auth/__tests__/auth.service.test.ts`

Spec test cases: T17 (deletes key on valid token), T18 (idempotent on invalid/missing).

- [ ] **Step 1: Add happy-path test**

```ts
describe('logout', () => {
  const userId = '00000000-0000-0000-0000-000000000001';
  const jti = '11111111-1111-1111-1111-111111111111';

  it('deletes the refresh key for valid token', async () => {
    const token = await forgeRefreshToken({ sub: userId, jti });

    await service.logout(token);

    expect(redis.del).toHaveBeenCalledWith(`refresh:${userId}`);
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test
```
Expected: FAIL.

- [ ] **Step 3: Implement `logout()`**

Replace the `logout` method body:
```ts
async logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  try {
    const verified = await jwtVerify(refreshToken, this.config.refreshSecret);
    const sub = verified.payload.sub;
    if (typeof sub === 'string' && sub.length > 0) {
      await this.redis.del(`refresh:${sub}`);
    }
  } catch {
    // Swallow: the token is already dead, logout is idempotent.
  }
}
```

- [ ] **Step 4: Run — should pass**

```bash
pnpm test
```
Expected: PASS.

- [ ] **Step 5: Add idempotency tests**

```ts
it('does not throw when token is undefined', async () => {
  await expect(service.logout(undefined)).resolves.toBeUndefined();
  expect(redis.del).not.toHaveBeenCalled();
});

it('does not throw when token is malformed', async () => {
  await expect(service.logout('garbage')).resolves.toBeUndefined();
  expect(redis.del).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Run — should pass**

```bash
pnpm test
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd ..
git add backend/src/modules/auth/auth.service.ts backend/src/modules/auth/__tests__/auth.service.test.ts
git commit -m "feat(backend/auth): logout() is idempotent on invalid tokens"
cd backend
```

---

## Task 11: `AuthService.verifyAccessToken()` — TDD

**Files:**
- Modify: `src/modules/auth/auth.service.ts`
- Modify: `src/modules/auth/__tests__/auth.service.test.ts`

Spec test cases: T19 (valid access token → { userId, role }), T20 (invalid → UnauthorizedError).

- [ ] **Step 1: Add helper for access tokens and happy-path test**

Add the helper near `forgeRefreshToken`:
```ts
async function forgeAccessToken(options: {
  sub: string;
  role: 'buyer' | 'admin';
  secret?: Uint8Array;
  expiresIn?: string;
  type?: string;
}): Promise<string> {
  const { SignJWT } = await import('jose');
  return new SignJWT({ role: options.role, type: options.type ?? 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(options.sub)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '15m')
    .sign(options.secret ?? testConfig.accessSecret);
}
```

Add test:
```ts
describe('verifyAccessToken', () => {
  const userId = '00000000-0000-0000-0000-000000000001';

  it('returns { userId, role } for valid access token', async () => {
    const token = await forgeAccessToken({ sub: userId, role: 'buyer' });

    const result = await service.verifyAccessToken(token);

    expect(result).toEqual({ userId, role: 'buyer' });
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test
```
Expected: FAIL.

- [ ] **Step 3: Implement `verifyAccessToken()`**

At the top of `auth.service.ts`, add the import of `UnauthorizedError` alongside existing imports:
```ts
import { UnauthorizedError } from '../../shared/middleware/error.middleware.js';
```

Replace the method body:
```ts
async verifyAccessToken(
  token: string,
): Promise<{ userId: string; role: 'buyer' | 'admin' }> {
  let payload: { sub?: string; role?: string; type?: string };
  try {
    const verified = await jwtVerify(token, this.config.accessSecret);
    payload = verified.payload as typeof payload;
  } catch {
    throw new UnauthorizedError('Invalid access token');
  }

  if (
    payload.type !== 'access' ||
    !payload.sub ||
    (payload.role !== 'buyer' && payload.role !== 'admin')
  ) {
    throw new UnauthorizedError('Invalid access token');
  }

  return { userId: payload.sub, role: payload.role };
}
```

- [ ] **Step 4: Run — should pass**

```bash
pnpm test
```
Expected: PASS.

- [ ] **Step 5: Add failure tests**

```ts
it('throws UnauthorizedError on malformed token', async () => {
  await expect(service.verifyAccessToken('garbage')).rejects.toThrow(
    'Invalid access token',
  );
});

it('throws UnauthorizedError on wrong-secret token', async () => {
  const wrongSecret = new TextEncoder().encode(
    'different-secret-that-is-also-32-chars-long-enough',
  );
  const token = await forgeAccessToken({
    sub: userId,
    role: 'buyer',
    secret: wrongSecret,
  });
  await expect(service.verifyAccessToken(token)).rejects.toThrow(
    'Invalid access token',
  );
});

it('throws UnauthorizedError when type is not "access"', async () => {
  const token = await forgeAccessToken({
    sub: userId,
    role: 'buyer',
    type: 'refresh',
  });
  await expect(service.verifyAccessToken(token)).rejects.toThrow(
    'Invalid access token',
  );
});
```

- [ ] **Step 6: Run — should pass**

```bash
pnpm test
```
Expected: all three new tests PASS. The service method is now covered end-to-end.

- [ ] **Step 7: Commit**

```bash
cd ..
git add backend/src/modules/auth/auth.service.ts backend/src/modules/auth/__tests__/auth.service.test.ts
git commit -m "feat(backend/auth): verifyAccessToken() used by authenticate middleware

Completes AuthService. All 20 service unit tests per spec section 8."
cd backend
```

- [ ] **Step 8: Run the full service test suite one more time to confirm**

```bash
pnpm test
```
Expected: ~20+ tests pass, 0 fail.

---

## Task 12: Rework `auth.middleware.ts` into a factory

**Files:**
- Modify: `src/shared/middleware/auth.middleware.ts`

- [ ] **Step 1: Replace the stub with a factory**

Replace the entire content of `src/shared/middleware/auth.middleware.ts`:
```ts
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { AuthService } from '../../modules/auth/auth.service.js';
import { UnauthorizedError } from './error.middleware.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      role: 'buyer' | 'admin';
    };
  }
}

/**
 * Factory that returns a Fastify preHandler hook closing over an AuthService.
 *
 * Usage in app.ts:
 *   app.decorate('authenticate', createAuthenticateHandler(authService));
 *
 * Usage in protected routes:
 *   app.get('/me', { preHandler: [app.authenticate] }, ...)
 */
export function createAuthenticateHandler(
  authService: AuthService,
): preHandlerAsyncHookHandler {
  return async function authenticate(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing Bearer token');
    }
    const token = header.slice('Bearer '.length);
    const { userId, role } = await authService.verifyAccessToken(token);
    request.user = { id: userId, role };
  };
}
```

Note: the middleware throws — the global error handler turns `UnauthorizedError` into a 401 JSON response, so we do not call `reply.send` here.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: pass.

- [ ] **Step 3: Commit**

```bash
cd ..
git add backend/src/shared/middleware/auth.middleware.ts
git commit -m "feat(backend): authenticate middleware factory

Turns the stub into a Fastify preHandler factory that closes over
AuthService.verifyAccessToken and attaches { id, role } to the request."
cd backend
```

---

## Task 13: Implement `auth.router.ts`

**Files:**
- Modify: `src/modules/auth/auth.router.ts`

- [ ] **Step 1: Replace the stub with 4 routes**

Replace the entire content of `src/modules/auth/auth.router.ts`:
```ts
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  authSuccessResponseSchema,
  loginBodySchema,
  refreshSuccessResponseSchema,
  registerBodySchema,
} from './auth.schema.js';
import type { AuthService } from './auth.service.js';

const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function buildAuthRouter(
  authService: AuthService,
  options: { isProduction: boolean },
): FastifyPluginAsync {
  const cookieBase = {
    httpOnly: true,
    secure: options.isProduction,
    sameSite: 'lax' as const,
    path: '/api/v1/auth',
  };

  const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.post(
      '/register',
      {
        schema: {
          tags: ['auth'],
          body: registerBodySchema,
          response: { 201: authSuccessResponseSchema },
        },
      },
      async (request, reply) => {
        const result = await authService.register(request.body);
        reply.setCookie(REFRESH_COOKIE_NAME, result.tokens.refreshToken, {
          ...cookieBase,
          maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
        });
        reply.status(201);
        return { user: result.user, accessToken: result.tokens.accessToken };
      },
    );

    typed.post(
      '/login',
      {
        schema: {
          tags: ['auth'],
          body: loginBodySchema,
          response: { 200: authSuccessResponseSchema },
        },
      },
      async (request, reply) => {
        const result = await authService.login(request.body);
        reply.setCookie(REFRESH_COOKIE_NAME, result.tokens.refreshToken, {
          ...cookieBase,
          maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
        });
        return { user: result.user, accessToken: result.tokens.accessToken };
      },
    );

    typed.post(
      '/refresh',
      {
        schema: {
          tags: ['auth'],
          response: { 200: refreshSuccessResponseSchema },
        },
      },
      async (request) => {
        const token = request.cookies[REFRESH_COOKIE_NAME];
        return authService.refresh(token);
      },
    );

    typed.post(
      '/logout',
      {
        schema: { tags: ['auth'] },
      },
      async (request, reply) => {
        const token = request.cookies[REFRESH_COOKIE_NAME];
        await authService.logout(token);
        reply.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/v1/auth' });
        reply.status(204);
        return;
      },
    );
  };

  return plugin;
}
```

Key points:
- The router is a **factory** (`buildAuthRouter`) that takes `AuthService` and production flag — it's not a bare plugin. This is because plugins register synchronously and we need the service instance already wired up.
- `withTypeProvider<ZodTypeProvider>()` enables automatic Zod parsing and type inference for `request.body`.
- `refresh` and `logout` read the cookie directly — no Zod body schema needed.
- `logout` always 204s; it never throws.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: pass. If `request.cookies` has type issues, confirm `@fastify/cookie` is registered in `app.ts` (we'll do that in Task 14).

- [ ] **Step 3: Commit**

```bash
cd ..
git add backend/src/modules/auth/auth.router.ts
git commit -m "feat(backend/auth): router with 4 endpoints + Zod type provider"
cd backend
```

---

## Task 14: Wire auth into `app.ts`

**Files:**
- Modify: `src/app.ts`

The existing `app.ts` registers a placeholder `authRouter` export from the stub. We'll replace it with the factory and wire in decorators.

- [ ] **Step 1: Replace `app.ts` content**

Replace `src/app.ts` with:
```ts
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import scalarApiReference from '@scalar/fastify-api-reference';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { catalogRouter } from './modules/catalog/catalog.router.js';
import { ordersRouter } from './modules/orders/orders.router.js';
import { AuthService, type AuthServiceConfig } from './modules/auth/auth.service.js';
import { buildAuthRouter } from './modules/auth/auth.router.js';
import { db } from './shared/db/client.js';
import { redis } from './shared/redis/client.js';
import { env } from './shared/env.js';
import { errorHandler } from './shared/middleware/error.middleware.js';
import { createAuthenticateHandler } from './shared/middleware/auth.middleware.js';

const API_PREFIX = '/api/v1';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: ReturnType<typeof createAuthenticateHandler>;
  }
}

function buildAuthServiceConfig(): AuthServiceConfig {
  return {
    accessSecret: new TextEncoder().encode(env.JWT_ACCESS_SECRET),
    refreshSecret: new TextEncoder().encode(env.JWT_REFRESH_SECRET),
    accessTtl: env.JWT_ACCESS_TTL,
    refreshTtl: env.JWT_REFRESH_TTL,
    refreshTtlSeconds: 60 * 60 * 24 * 30, // hardcoded to match the env default of '30d'
  };
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        env.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            }
          : undefined,
    },
    disableRequestLogging: false,
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);

  await app.register(cors, {
    origin: env.NODE_ENV === 'production' ? false : true,
    credentials: true,
  });

  await app.register(cookie);

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Flowers B2B API',
        description: 'B2B wholesale flower marketplace API',
        version: '0.1.0',
      },
      servers: [{ url: `http://${env.HOST}:${env.PORT}${API_PREFIX}` }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(scalarApiReference, {
    routePrefix: '/docs',
    configuration: {
      theme: 'purple',
    },
  });

  // Build services (single instances, injected via closures).
  const authService = new AuthService(db, redis, buildAuthServiceConfig());
  app.decorate('authenticate', createAuthenticateHandler(authService));

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(
    async (api) => {
      await api.register(
        buildAuthRouter(authService, {
          isProduction: env.NODE_ENV === 'production',
        }),
        { prefix: '/auth' },
      );
      await api.register(catalogRouter);
      await api.register(ordersRouter);
    },
    { prefix: API_PREFIX },
  );

  return app;
}
```

Changes vs scaffold:
- Imported `validatorCompiler`, `serializerCompiler`, `jsonSchemaTransform`, `ZodTypeProvider` from `fastify-type-provider-zod`.
- Imported `db` and `redis` concrete instances (these trigger `env.ts` validation at startup, which is what we want).
- Imported `AuthService`, `buildAuthRouter`, `createAuthenticateHandler`.
- Replaced `authRouter` (stub import) with `buildAuthRouter(authService, ...)` call after instantiating the service.
- Added `.withTypeProvider<ZodTypeProvider>()` to the Fastify instance and set `validatorCompiler` / `serializerCompiler`.
- Added `app.decorate('authenticate', ...)` so protected routes can use `preHandler: [app.authenticate]`.
- Extended Swagger with `transform: jsonSchemaTransform` so Zod schemas become JSON Schema in the OpenAPI spec.
- Added module augmentation for `FastifyInstance.authenticate`.

Note on `refreshTtlSeconds`: we hardcode 2592000 for now. A future refactor can parse the human-readable TTL string, but the env default is `30d` and we do not support configuring otherwise in MVP.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: pass. Any type errors are likely in the Fastify type provider plumbing — double-check `withTypeProvider` is called on the Fastify instance and that the router uses the typed accessor `app.withTypeProvider<ZodTypeProvider>()`.

- [ ] **Step 3: Run tests**

```bash
pnpm test
```
Expected: all auth service tests still pass.

- [ ] **Step 4: Commit**

```bash
cd ..
git add backend/src/app.ts
git commit -m "feat(backend): wire auth service and decorator into app.ts

Registers fastify-type-provider-zod, instantiates AuthService once,
decorates the app with authenticate(), and mounts the auth router
under /api/v1/auth."
cd backend
```

---

## Task 15: Manual smoke test

**Files:** none — this task verifies the running system.

**Prerequisites:** Docker is running, migration has been applied (Task 3).

- [ ] **Step 1: Start the dev server**

Run:
```bash
pnpm dev
```
Expected: logs show `Server listening at http://0.0.0.0:3000` and `API docs available at http://0.0.0.0:3000/docs`. No errors about missing env vars.

- [ ] **Step 2: Open the API docs in a browser**

Visit `http://localhost:3000/docs`. Expected: Scalar UI renders with the auth endpoints (`POST /api/v1/auth/register`, `login`, `refresh`, `logout`) visible and their request bodies documented from Zod schemas.

- [ ] **Step 3: Register a new user via curl**

Run (in a new terminal):
```bash
curl -i -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -c /tmp/cookies.txt \
  -d '{
    "email": "buyer@example.com",
    "password": "correct-horse-battery",
    "companyName": "Acme Flowers"
  }'
```
Expected:
- Status `201 Created`
- `Set-Cookie: refresh_token=...; Path=/api/v1/auth; HttpOnly; SameSite=Lax`
- Body: `{ "user": { "id": "...", "email": "buyer@example.com", "companyName": "Acme Flowers", "role": "buyer", "status": "active", "createdAt": "..." }, "accessToken": "eyJ..." }`

- [ ] **Step 4: Try to register the same email again**

```bash
curl -i -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "buyer@example.com",
    "password": "another-pass-long-enough",
    "companyName": "Acme Flowers Again"
  }'
```
Expected: `409 Conflict` with body `{ "error": { "code": "EMAIL_ALREADY_REGISTERED", "message": "Email is already registered" } }`.

- [ ] **Step 5: Log in**

```bash
curl -i -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -c /tmp/cookies.txt \
  -d '{
    "email": "buyer@example.com",
    "password": "correct-horse-battery"
  }'
```
Expected: `200 OK`, new `refresh_token` cookie, body same shape as register response.

- [ ] **Step 6: Log in with wrong password**

```bash
curl -i -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "buyer@example.com",
    "password": "wrong-password-here"
  }'
```
Expected: `401 Unauthorized`, code `INVALID_CREDENTIALS`.

- [ ] **Step 7: Log in with nonexistent email**

```bash
time curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "does-not-exist@example.com",
    "password": "anything-here"
  }'
```
Expected: `401`. Compare the response time with the wrong-password case — they should be within ~50ms of each other (bcrypt dominates). If the nonexistent case returns significantly faster, the timing equalization is broken.

- [ ] **Step 8: Refresh the access token**

```bash
curl -i -X POST http://localhost:3000/api/v1/auth/refresh \
  -b /tmp/cookies.txt
```
Expected: `200 OK`, body `{ "accessToken": "eyJ..." }`, no new `Set-Cookie` header.

- [ ] **Step 9: Log out**

```bash
curl -i -X POST http://localhost:3000/api/v1/auth/logout \
  -b /tmp/cookies.txt -c /tmp/cookies.txt
```
Expected: `204 No Content`, `Set-Cookie: refresh_token=; Max-Age=0; Path=/api/v1/auth`.

- [ ] **Step 10: Refresh after logout**

```bash
curl -i -X POST http://localhost:3000/api/v1/auth/refresh \
  -b /tmp/cookies.txt
```
Expected: `401 Unauthorized`, code `INVALID_REFRESH_TOKEN`. The Redis key was deleted, and even if the cookie is still present, the jti no longer matches.

- [ ] **Step 11: Stop the dev server**

Ctrl+C in the `pnpm dev` terminal.

- [ ] **Step 12: Final sanity — full test suite**

```bash
pnpm test
pnpm typecheck
```
Expected: all tests pass, no type errors.

- [ ] **Step 13: Commit the plan completion marker (optional)**

If you want a clear marker commit at the end:
```bash
cd ..
git commit --allow-empty -m "chore: auth module implementation complete

All spec sections implemented and smoke-tested. Ready for catalog
module."
cd backend
```

---

## Out of scope (confirmations)

These are intentionally NOT in this plan and MUST NOT be added mid-execution:

- Email verification flow
- Password reset (`/auth/forgot-password`, `/auth/reset-password`)
- Rate limiting on `/auth/login`
- Admin management endpoints (`POST /admin/invite-codes` was removed; `PATCH /admin/users/:id` is part of a future admin task)
- Seller auth of any kind
- Session listing ("my devices") — incompatible with single-session anyway
- Multi-session support
- Refresh token rotation
- HTTP integration tests via `fastify.inject`
- Real Postgres / Redis in tests (all service tests use mocks)
