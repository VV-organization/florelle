# Local validation

All checks below ran in this workspace. No external payment, production deployment or external email was performed.

| Check | Evidence |
|---|---|
| Backend typecheck/build | `pnpm typecheck`, `pnpm build`: passed |
| Backend unit + real PostgreSQL commerce/auth | `TEST_DATABASE_URL=<local-test-db> pnpm test`: 329 passed, 7 imported-catalog tests skipped |
| Imported catalog/media | `RUN_DATABASE_TESTS=1 pnpm test src/modules/media/__tests__/catalog.integration.test.ts`: 7 passed separately |
| Fresh database | Entire migration chain0023–0027 including prior source migrations applied successfully to a new local database; commerce/auth suite passed; database removed afterward |
| Frontend | `npm run typecheck`, `npm run build`: passed; `TEST_BASE_URL=http://127.0.0.1:5194 npm test`: 8 passed |
| Runtime flow | `node scripts/smoke-local.mjs`: local Mailpit registration/verification, profile update, refresh cookie, authenticated cart, server quote, disabled-checkout without reservation, logout passed |
| Containers | Both Docker images built; frontend production SSR `/`, `/catalog`, `/delivery`, `/account`, `/checkout`, `/orders` returned200; all8 frontend tests passed against the container upstream |
| Production dependencies | Backend `pnpm audit --prod`, frontend `npm audit --omit=dev`: zero known advisories after runtime dependency update |
| Visual sources | CSS changes limited to six image URL substitutions; original image bytes/variants/framing retained; legal and core motion components unchanged |
| Source project | Flower Point repository unmodified; original unrelated untracked files preserved |

The imported snapshot contains511 products,1000 offers,31 categories,94 sellers,3 collections,55 memberships and2443 source images (2358 unique hashes,536321859 bytes). Idempotent imports do not reset stock.

The336 backend cases were verified in two groups:329 general/commerce/auth and7 import/media. Running both groups concurrently against the same imported DB can temporarily alter count-based fixture assertions; run them sequentially.

## Review findings resolved

- Production frontend now receives runtime `BACKEND_URL`; container SSR/API/media tests verify it.
- Verification requires the specific `challengeId` returned to the initiating registration. The challenge carries submitted credential/profile data; activation cannot retain an attacker's pre-registration password. Two real PostgreSQL regressions failed before the change and pass afterward.
- Signed callback recovery validates merchant, amount, currency and signature before binding a lost provider identity. Concurrent notifications settle once; a late creation response or timeout cannot overwrite the settled attempt.
- RUB settlement, commission and minimum are independent of the selected display currency.

## Acceptance limits

Browser screenshot comparison has not been performed: the preferred browser tool was unavailable and permission for an alternative surface was not answered. Source/CSS/media checks do not prove pixel parity at every viewport.

Production SMTP, Arcopay and VV Admin require independent credentials and an authorized acceptance run. Local payments are disabled. Automatic synthetic payment scenarios are intentionally not advertised because no authoritative provider cancellation contract is available; manual signed runs retain pending reservations until verified terminal callbacks.

Development services remain available at UI5194, API5195 and Mailpit58025. PostgreSQL55444 and Redis56389 are isolated from the source project's services. Temporary container checks and their network are removed after validation.
