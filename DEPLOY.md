# Florelle stage deployment

Deployment follows `../deploy-templates/templates/workflow.deploy.yaml` and the `multi-service` / `node-ssr` templates. There is one stage entry point: root `docker-compose.yaml` and `.github/workflows/deploy.yaml`.

## Runner and trigger

- Branch: `main`.
- Runner: self-hosted, with label `florelle-stage`.
- Server environment: `~/.envs/florelle/.env`, mode600; parent directory mode700.
- Runner needs Docker Engine and the Compose plugin, with permission to use Docker.
- Workflow serializes deployment with concurrency group `florelle-stage` and does only checkout, env copy, `docker compose build`, `docker compose up -d`, and unconditional env cleanup.
- Separate backend/frontend CI remains under root `.github/workflows`; it tests/builds but does not deploy. Do not run untrusted PR code on the stage runner.

Runner registration, server secret creation, DNS/TLS and the first remote workflow run are server setup tasks. They are not performed by committing this configuration.

## Server environment

Start with root `.env.example`, replacing example values on the server. Required values:

- PostgreSQL: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`. Use a random hexadecimal password so it is safe inside the derived database URL.
- Auth: independent `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (at least32 random characters each).
- Mail: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`.
- FX: `FX_API_KEY`; use `FX_OFFLINE=false` for provider updates.
- Public HTTPS origins: `PUBLIC_FRONTEND_URL`, `PUBLIC_API_URL` (ending `/api/v1`).
- Payments: initially `PAYMENT_PROVIDER=disabled`. For new Arc Pay hosted SBP checkout, use `PAYMENT_PROVIDER=arc_pay`, `ARC_PAY_BASE_URL=https://api.arcpay.space/v1`, `ARC_PAY_SECRET_KEY`, and the portal endpoint `ARC_PAY_WEBHOOK_SECRET`. `PUBLIC_FRONTEND_URL` and `PUBLIC_API_URL` must be HTTPS. Follow [Arc Pay activation and verification](docs/ARC-PAY.md). Legacy `arcopay` settings are separate; preserve them while legacy attempts remain unresolved.
- Optional VV Admin: `FLORELLE_INTEGRATION_TOKEN`, `VV_ADMIN_INTEGRATION_SECRET`, `VV_ADMIN_INTEGRATION_ENABLED`, `VV_ADMIN_WEBHOOK_URL`, `VV_ADMIN_WEBHOOK_SITE_KEY`, `VV_ADMIN_WEBHOOK_SECRET`, `VV_ADMIN_WEBHOOK_SECRET_VERSION`.

Compose derives Docker-only `DATABASE_URL` and `REDIS_URL`, and overrides internal listening ports/media/upstream paths. Secrets never enter build args or images. Frontend's build-time upstream defaults to the same internal backend address as its runtime override.

## Persistent data and first installation

Create these server paths before starting:

| Data | Host path | Container path |
|---|---|---|
| PostgreSQL | `/opt/florelle/volumes/postgres` | `/var/lib/postgresql/data` |
| Redis | `/opt/florelle/volumes/redis` | `/data` |
| Images | `/opt/florelle/volumes/media` | `/app/media` |

Media must be writable by UID/GID1000 (backend user `node`). The PostgreSQL/Redis images initialize their own data directories. Named volumes and host source mounts are absent from stage Compose.

An empty database receives schema migrations automatically, but migrations do not invent catalog data. Before exposing the first installation, restore the prepared Florelle database and copy the contents of `backend/.runtime/media` into the server media directory, or run the documented source importer against the stage database. Use [backend import instructions](backend/README.md). Do not reuse a Flower Point database. The original frontend photographs remain reproducible from Git commit `130ef91`; the migration JSON lives in `backend/import-data`.

Keep catalog initialization separate from subsequent deploys: never reset live inventory/users/orders. Back up PostgreSQL and the media directory together, and test restoration on an isolated instance. The one-shot migration service finishes before backend startup; Redis and PostgreSQL health checks gate dependents.

## Ports and external infrastructure

| Service | Host bind | Container listen |
|---|---|---|
| Frontend | `127.0.0.1:3000` | `0.0.0.0:3000` |
| Backend | `127.0.0.1:3001` | `0.0.0.0:3000` |
| PostgreSQL / Redis | not published | internal5432 /6379 |

Reverse proxy, TLS and DNS are managed separately and are not part of this repository's deploy. The frontend serves browser routes and proxies `/api/v1` and `/media` internally. External infrastructure must route operational endpoints `/admin/integration`, `/.well-known/vv-admin` and `/health` to backend port3001. Preserve the public host/protocol, HTTPS cookies and a10MB upload limit. No extra proxy service is started by this Compose.

## Local development and validation

`backend/compose.local.yaml` remains a development-only PostgreSQL/Redis/Mailpit stack on isolated ports. Its existing local volumes are retained; it is not a stage deployment alternative. Local backend/frontend env examples remain in their subdirectories.

Before deploying, validate root Compose with test env values (`docker compose config --quiet`) and build (`docker compose build`). Never commit the root `.env`. Workflow always deletes its temporary root copy; the source file in `~/.envs/florelle/.env` stays on the server.

The previous `backend/docker-compose.yml` (named volumes, embedded proxy and8080 port) and `backend/deploy/nginx.conf` were removed. Nested CI files were moved to root and their working directories corrected. No GitHub Pages/Render deployment is active.
