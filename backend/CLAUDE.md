# Florelle

See docs/IMPLEMENTATION.md for accepted scope and README.md for operation.
Independent backend derived from Flower Point; do not modify the source repository.
Preserve all designer frontend visuals. PostgreSQL owns catalog, exact native prices,
inventory, delivery settings, carts and immutable order snapshots. Images live on
owned persistent disk. Import is idempotent and must never reset live inventory.
Payment requests have durable idempotency keys and fixed RUB amounts. Persist the
provider identity before requesting a QR link. Uncertain provider outcomes retain
inventory for review. Only authenticated, amount/currency/identity-matching callbacks
settle orders. Never substitute demo payment success for missing credentials.
Run pnpm typecheck, pnpm test, pnpm build; integration tests use TEST_DATABASE_URL
and unique isolated fixtures. No push/deploy or real external test without authorization.
