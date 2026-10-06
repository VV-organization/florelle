# Deployment and recovery

Stage deployment is defined only at the repository root. See [root DEPLOY.md](../../DEPLOY.md) for the self-hosted runner, env file, ports and persistent data. Local development remains documented in [backend README](../README.md).

## Payment recovery

`checkout_attempts` stores fixed RUB amounts, merchant/provider identities, leases and payment URLs. The worker resumes an unstarted intent or retries link creation for a saved provider ID. It never repeats an ambiguous provider creation. Such attempts retain stock in `review`; signed callbacks with matching merchant, amount and currency can restore their identity and settle atomically. Never mark paid from a redirect or release stock solely because of a timeout.

`PAYMENT_PROVIDER=disabled` rejects checkout before reservation. Independent SMTP, FX, Arcopay and VV Admin configuration and an authorized acceptance test are needed for remote operation. Automatic synthetic scenarios remain unadvertised without an authoritative cancellation contract.

## Backups

From the repository root with the server environment available to Compose, use `docker compose exec -T postgres pg_dump -U <database-user> -Fc <database-name>` to save the database to protected backup storage. Copy `/opt/florelle/volumes/media` alongside it. Redis resides at `/opt/florelle/volumes/redis`; restore its persistent data or deliberately revoke sessions. Never run `down -v` or restore over a live database without an explicit maintenance plan.

Test restoration separately and verify catalog counts, order snapshots and media hashes. Do not roll back schema blindly.
