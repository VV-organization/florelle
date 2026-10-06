# Florelle backend

Fastify + PostgreSQL + Redis. The frontend lives in sibling `../frontend`. Catalog and delivery content are stored in PostgreSQL; photographs are served from `MEDIA_ROOT`.

## Local start

Node 24 and pnpm 10.30.3 are used. Copy `.env.example` to `.env`, replace JWT values, then:

```sh
pnpm install --frozen-lockfile
docker compose -f compose.local.yaml up -d
pnpm db:migrate
pnpm import:check
pnpm import:apply
pnpm dev
```

Local API: http://127.0.0.1:5195, frontend: http://127.0.0.1:5194, Mailpit: http://127.0.0.1:58025. No external email is sent locally. Payment is disabled until independent Arcopay credentials are configured; checkout returns `PAYMENTS_NOT_CONFIGURED`, never a simulated success.

## Preserved source data and media

`import-data` contains the original commercial JSON. The importer preserves UUIDs, exact RUB retail/wholesale/reference prices, stock in stems, ordering, translations, delivery tables and media framing. It copies byte-identical images to hash-addressed files, preserving all supplied responsive variants. Existing DB rows are not overwritten on repeated import, including stock already sold.

Set `IMPORT_PUBLIC_ROOT` to an export of the original frontend `public` directory. The current workspace has that export at `../.artifacts/reference/public` (designer commit `130ef91`). For a fresh checkout, export it from frontend Git history before importing:

```sh
mkdir -p ../.artifacts/reference
git -C ../frontend archive 130ef91 public | tar -x -C ../.artifacts/reference
```

Run the dry-run first. Expected import: 511 products, 1000 listings, 31 categories, 94 sellers, 3 collections, 55 memberships, 2443 source image files (2358 unique hashes). The photographs are excluded from backend Git; back up `MEDIA_ROOT` separately. New media: authenticated raw-image `POST /admin/integration/media` with `Authorization: Bearer $FLORELLE_INTEGRATION_TOKEN` and JPEG/PNG/WebP Content-Type. Max 10 MB, original bytes plus resized WebP variants; use returned `photo.url` in catalog writes.

## Verification

```sh
pnpm typecheck
pnpm test
TEST_DATABASE_URL=postgresql://florelle:florelle-local-only@127.0.0.1:55444/florelle pnpm test
pnpm build
RUN_DATABASE_TESTS=1 pnpm test src/modules/media/__tests__/catalog.integration.test.ts
```

Commerce/auth DB tests create and clean their own fixtures. Run imported-catalog checks separately after them because they verify exact source counts. `node scripts/smoke-local.mjs` verifies local Mailpit registration, challenge ownership, profile, refresh, cart and checkout quote through the running frontend. They cover concurrent inventory allocation, idempotency, immutable prices, failed QR resumption, unknown provider outcomes and webhook validation. No real provider payments are made.

## Deployment and recovery

See [root stage deployment instructions](../DEPLOY.md). The runtime needs independent PostgreSQL, Redis, SMTP, Arcopay, FX and VV Admin credentials. `/health` is process liveness; `/health/ready` distinguishes configured services, and is not payment-settlement evidence.
