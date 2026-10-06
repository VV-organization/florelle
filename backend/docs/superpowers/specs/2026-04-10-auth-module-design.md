# Auth module — design spec

**Date:** 2026-04-10
**Module:** `src/modules/auth`
**Status:** approved (pending implementation)

## 1. Context

The auth module is the first feature to be implemented on top of the
scaffold. It covers registration, login, refresh, logout, and the
authentication middleware used by all protected routes.

During brainstorming the business model was changed relative to the
original `CLAUDE.md`: **buyer registration is now open** (no invite code
required). Sellers remain as before — admin-managed rows in the `sellers`
table with no login. This change cascades into the schema, the register
endpoint, the admin endpoint list, and the business rules section of
`CLAUDE.md`.

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Status on successful register | `active` immediately | Fast MVP funnel; no invite gate means we optimise for conversion. `pending` remains in the enum for admin-initiated suspensions but is not part of the registration flow. |
| Invite codes | Removed entirely | YAGNI. No business requirement for referral or admin-invited users in MVP. |
| Session model | Single-session per user | A fresh login overwrites the previous session. Simplest correct implementation; good fit for MVP. |
| Refresh rotation | None | `/auth/refresh` issues a new access token only. The refresh token and Redis state are untouched; refresh lives the full 30 days from login. |
| Frontend ↔ backend topology | Same-origin (Vite proxy in dev, reverse proxy in prod) | Avoids cross-origin cookie pain (`SameSite=None`, preflights). Canonical full-stack setup. |
| Service layering | Single `AuthService` class | Matches the file layout already documented in `CLAUDE.md`. 4 endpoints do not justify splitting out a `TokenService`. |
| Zod ↔ Fastify glue | `fastify-type-provider-zod` | Automatic type inference in handlers and automatic Swagger documentation. One small dependency. |

## 3. Schema changes

File: `src/shared/db/schema/users.ts`.

**Remove:**
- Table `inviteCodes` (and exported types `InviteCode`, `NewInviteCode`)
- Column `users.inviteCodeUsed`

**Modify:**
- `users.status` default: `'pending'` → `'active'`

**Keep unchanged:**
- Enums `userRoleEnum` (`buyer | admin`), `userStatusEnum`
  (`pending | active | suspended`)
- Column set: `id, email, passwordHash, companyName, role, status,
  createdAt, updatedAt`
- `email` uniqueness constraint

The `pending` status value is retained in the enum for future use (e.g.,
admin freezing an account pending review) but is not used by the
registration flow.

## 4. Endpoint contracts

All endpoints live under `/api/v1/auth`.

### `POST /auth/register`

**Request body** (Zod):

```ts
{
  email: string,         // email format, lowercased before persistence
  password: string,      // min 8, max 128 chars
  companyName: string,   // min 2, max 200, trimmed
}
```

**Responses:**
- `201 Created` — `{ user, accessToken }` + `Set-Cookie: refresh_token=...`
- `409 CONFLICT` — `EMAIL_ALREADY_REGISTERED`
- `422 VALIDATION_ERROR` — Zod failure

**Success body:**

```ts
{
  user: {
    id: string,
    email: string,
    companyName: string,
    role: 'buyer',
    status: 'active',
    createdAt: string,
  },
  accessToken: string,   // JWT, 15m TTL
}
```

**Side effects:** Write `refresh:{userId} = <jti>` to Redis with TTL 30d;
set `refresh_token` cookie.

### `POST /auth/login`

**Request body:**

```ts
{ email: string, password: string }
```

**Responses:**
- `200 OK` — same shape as register
- `401 UNAUTHORIZED` — `INVALID_CREDENTIALS` (identical message for both
  "email not found" and "wrong password" — no enumeration oracle)
- `403 FORBIDDEN` — `ACCOUNT_SUSPENDED` (for `status = 'suspended'`)
- `422 VALIDATION_ERROR`

**Single-session invariant:** Login **overwrites** `refresh:{userId}` in
Redis. The previous session on any other device will fail its next
`/auth/refresh` call.

### `POST /auth/refresh`

**Request:** cookie `refresh_token`, empty body.

**Responses:**
- `200 OK` — `{ accessToken }`
- `401 UNAUTHORIZED` — `INVALID_REFRESH_TOKEN` (no cookie, invalid JWT,
  wrong token type, jti mismatch, user disappeared)
- `403 FORBIDDEN` — `ACCOUNT_SUSPENDED`

Refresh token and Redis state are not modified. Cookie is not re-set.

### `POST /auth/logout`

**Request:** cookie `refresh_token`.

**Response:**
- `204 No Content` — always. Idempotent; absent or invalid token still
  yields 204.

**Side effects:** `DEL refresh:{userId}` (best-effort — missing key is
not an error); `Set-Cookie: refresh_token=; Max-Age=0`.

### Auth middleware — `app.authenticate`

Registered in `app.ts` as a Fastify decorator, used by protected routes
via `preHandler: [app.authenticate]`.

Steps:
1. Read `Authorization: Bearer <token>`. Missing → 401.
2. Verify JWT signature and `exp` with `JWT_ACCESS_SECRET`. Fail → 401.
3. Check `payload.type === 'access'`. Fail → 401.
4. Load `users.status` by `payload.sub`. `suspended` → 403, missing → 401.
5. Attach `request.user = { id, role }` (via module augmentation already
   in `src/shared/middleware/auth.middleware.ts`).

The status check in middleware is what makes admin-initiated suspensions
take effect within 15 minutes (the access token TTL) rather than waiting
for the full 30-day refresh window.

## 5. JWT and Redis

### Access token

- Algorithm: `HS256`
- Secret: `JWT_ACCESS_SECRET`
- TTL: 15 minutes (`JWT_ACCESS_TTL`)
- Claims:
  ```ts
  {
    sub: string,           // users.id
    role: 'buyer' | 'admin',
    type: 'access',
    iat, exp,
  }
  ```

### Refresh token

- Algorithm: `HS256`
- Secret: `JWT_REFRESH_SECRET` (**distinct** from access secret — isolates
  blast radius if one leaks)
- TTL: 30 days (`JWT_REFRESH_TTL`)
- Claims:
  ```ts
  {
    sub: string,           // users.id
    jti: string,           // UUID v4, generated at issuance
    type: 'refresh',
    iat, exp,
  }
  ```

The `type` claim defends against confused-deputy attacks (submitting an
access token where a refresh is expected, or vice versa).

### Redis layout

- Key: `refresh:{userId}`
- Value: the `jti` string (not the full JWT — we only need to identify
  the current session)
- TTL: 30 days, set with `SET ... EX 2592000`

Single-session is enforced by the fact that one key per user means each
login/register simply `SET`s the new jti, implicitly orphaning the
previous one. Stale refresh tokens fail step 5 of the `/auth/refresh`
flow (jti mismatch).

### `/auth/refresh` verification sequence

1. Read `refresh_token` cookie. Missing → 401.
2. `jwtVerify(token, JWT_REFRESH_SECRET)`. Invalid or expired → 401.
3. `payload.type === 'refresh'`. Fail → 401.
4. `redis.get('refresh:' + payload.sub)`. Null → 401 (user logged out).
5. Redis value equals `payload.jti`. No → 401 (session superseded).
6. `users.status` is not `'suspended'`. Is → 403.
7. Sign and return a new access token; cookie untouched.

### Logout sequence

1. If no cookie → return 204.
2. Try `jwtVerify`. On success, `redis.del('refresh:' + payload.sub)`.
3. Clear cookie (`Set-Cookie: refresh_token=; Max-Age=0`) and return 204.

Verification failure is swallowed — the token is dead either way, and we
do not want logout to leak information about token validity.

## 6. Password, cookie, CORS

### Password hashing

- `bcrypt.hash(password, 12)` — cost factor from `CLAUDE.md`.
- `bcrypt.compare(password, hash)` for verification.
- **Timing-equalised login:** if the email is not found, still run
  `bcrypt.compare(password, FAKE_HASH)` with a constant pre-computed
  hash to avoid giving `/auth/login` a response-time oracle for email
  enumeration. `FAKE_HASH` is generated once at module load via
  `bcrypt.hashSync('unused', 12)`.

### Password requirements

- Min 8 chars, max 128 chars, no complexity rules (NIST SP 800-63B
  guidance: length over character-class gymnastics).
- 128-char ceiling prevents bcrypt-based DoS and documents the effective
  limit (bcrypt truncates at 72 bytes anyway).

### `refresh_token` cookie

```ts
reply.setCookie('refresh_token', jwt, {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/v1/auth',
  maxAge: 60 * 60 * 24 * 30, // 30 days in seconds
  signed: false,              // JWT is self-signed
})
```

- `httpOnly`: unreadable from page JS, XSS-proof.
- `secure`: production only — browsers refuse Secure cookies over HTTP,
  so dev on `localhost` needs it off.
- `sameSite: 'lax'`: safe for the same-origin topology.
- `path: '/api/v1/auth'`: cookie is sent only to auth endpoints. The
  catalog and orders APIs never see it.

### CORS

```ts
await app.register(cors, {
  origin: env.NODE_ENV === 'production' ? false : true,
  credentials: true,
})
```

- Production: same-origin, CORS effectively disabled (`origin: false`).
  Can be flipped to an explicit whitelist if the frontend is later split
  onto its own domain.
- Development: permissive with credentials so a non-proxied frontend
  still works locally.

## 7. File structure

New files inside the module:

```
src/modules/auth/
├── auth.router.ts        # Fastify plugin: 4 routes, Zod validation
├── auth.service.ts       # Business logic: register/login/refresh/logout/verifyAccessToken
├── auth.schema.ts        # Zod schemas + inferred types
├── auth.errors.ts        # Typed errors (subclasses of AppError)
└── __tests__/
    └── auth.service.test.ts
```

Modifications outside the module:

- `src/shared/db/schema/users.ts` — remove invite codes, change default
  status.
- `src/shared/middleware/auth.middleware.ts` — replace the no-op stub
  with a working Fastify decorator that delegates to
  `AuthService.verifyAccessToken`.
- `src/app.ts` — register `authRouter`, register Zod type provider,
  decorate the instance with `db`, `redis`, and `authenticate`.
- `package.json` — add `fastify-type-provider-zod`.
- `src/shared/env.ts` — no changes required (JWT secrets already
  validated).

### `AuthService` shape

```ts
class AuthService {
  constructor(db: Database, redis: RedisClient) {}

  async register(input: RegisterBody): Promise<AuthSuccess>
  async login(input: LoginBody): Promise<AuthSuccess>
  async refresh(refreshToken: string | undefined): Promise<{ accessToken: string }>
  async logout(refreshToken: string | undefined): Promise<void>
  async verifyAccessToken(token: string): Promise<{ userId: string; role: UserRole }>
}

type AuthSuccess = {
  user: PublicUser
  tokens: { accessToken: string; refreshToken: string }
}
```

Private helpers: `signAccessToken`, `signRefreshToken`,
`verifyRefreshTokenAndSession`, `hashPassword`, `verifyPassword`.

### Typed errors (`auth.errors.ts`)

Each extends `AppError`:

- `EmailAlreadyRegisteredError` → 409 `EMAIL_ALREADY_REGISTERED`
- `InvalidCredentialsError` → 401 `INVALID_CREDENTIALS`
- `AccountSuspendedError` → 403 `ACCOUNT_SUSPENDED`
- `InvalidRefreshTokenError` → 401 `INVALID_REFRESH_TOKEN`

The global error handler in `src/shared/middleware/error.middleware.ts`
already handles `AppError` subclasses; no handler changes needed.

## 8. Testing strategy

`src/modules/auth/__tests__/auth.service.test.ts` — Vitest, mocked DB
and Redis clients. The service is instantiated with the mocks in every
test.

### Test cases

**`register`**
1. Hashes password with cost factor 12.
2. Rejects existing email with `EmailAlreadyRegisteredError`.
3. Creates user with `status: 'active'`, `role: 'buyer'`.
4. Issues a token pair and writes `refresh:{userId}` with TTL 2592000.
5. Response omits `passwordHash`.

**`login`**
6. Happy path: returns token pair and `publicUser`.
7. Unknown email: `InvalidCredentialsError`, **and** `bcrypt.compare` is
   still invoked (timing equalisation — verified via spy).
8. Wrong password: `InvalidCredentialsError`.
9. `suspended` user: `AccountSuspendedError`.
10. Login overwrites the existing Redis refresh key (new jti).

**`refresh`**
11. Happy path: new access token; cookie and Redis untouched.
12. Missing cookie: `InvalidRefreshTokenError`.
13. Malformed/expired JWT: `InvalidRefreshTokenError`.
14. `payload.type !== 'refresh'`: `InvalidRefreshTokenError`.
15. jti does not match Redis: `InvalidRefreshTokenError`.
16. `suspended` user: `AccountSuspendedError`.

**`logout`**
17. Valid token: deletes Redis key.
18. Missing or invalid token: does not throw (idempotent).

**`verifyAccessToken`** (used by middleware)
19. Valid access token: returns `{ userId, role }`.
20. Invalid: throws `UnauthorizedError`.

### Mocking policy

- `Database` and `RedisClient` — hand-rolled `vi.fn()` stubs with the
  minimum surface area the service actually calls. No attempt to mock
  the whole Drizzle query builder.
- `bcrypt` — module-mocked via `vi.mock('bcrypt', ...)`.
- `jose` — **not mocked**. JWT signing and verification are fast,
  deterministic pure functions; running them for real catches format
  and payload mistakes the mocks would hide.

### Out of scope for this module's tests

- HTTP-layer integration tests via `fastify.inject`. May be added later
  as one smoke test per route if coverage feels thin, but `CLAUDE.md`
  only mandates service-level unit tests.
- Real Postgres / Redis integration. No fixtures exist yet.

## 9. Required `CLAUDE.md` updates

These must be applied **before** implementation starts so that the spec
and the source of truth do not drift.

1. **Line 8 (MVP constraints):** Remove
   `Buyers register via invite code only — no open registration`.
2. **Domain models → users:** Remove the `invite_code_used` column.
3. **Domain models → invite_codes:** Remove the entire table.
4. **Endpoint map → `POST /auth/register`:** Change body to
   `{ email, password, company_name }`.
5. **Endpoint map → admin section:** Remove `POST /admin/invite-codes`.
6. **Business rules → rule 1 ("Invite gate"):** Remove the rule and
   renumber the rest (2→1, 3→2, ...).
7. **Project structure tree (auth module):** Remove
   `invite.service.ts`.

## 10. Out of scope

- Email verification, referral programs, social login, admin-seeded
  invites — all intentionally deferred.
- Rate limiting on `/auth/login` — not required for MVP; can be added as
  a global Fastify plugin later.
- Password reset flow (`/auth/forgot-password`, `/auth/reset-password`)
  — not in `CLAUDE.md`; deferred.
- Seller-facing auth — does not exist by design.
