# Deployment

The app needs Node.js 24 and a persistent writable SQLite disk. GitHub Pages cannot run its accounts/order API. Do not deploy this SQLite configuration to an ephemeral/serverless filesystem.

## Render from GitHub

1. Connect `VV-organization/florelle` to Render using New → Blueprint. The repository includes `render.yaml` and `Dockerfile`.
2. Review the Starter service and 1 GB persistent disk cost in Render before creating resources. Nothing is purchased by committing this configuration.
3. Render builds the production image, mounts `/app/data`, and waits for `/api/health`. The default HTTPS origin is read from `RENDER_EXTERNAL_URL`.
4. For a custom domain set `APP_ORIGIN` to its exact HTTPS origin (no trailing slash). Keep one running instance while using SQLite.
5. Back up the SQLite database using a SQLite-aware backup before migrations or disk changes; a Git push is not a database backup.

The GitHub workflow builds on Linux, builds the actual Docker image, starts it and verifies assets, registration, sessions, isolation and order drafts. Automatic Render deploys wait for checks to pass. The workflow uses an isolated disposable database.

## Other Docker hosts

Build with `docker build -t florelle .`. Run with a persistent volume at `/app/data`, `APP_ORIGIN` set to the public HTTPS origin, port 3000 exposed behind HTTPS, and a health check at `/api/health`. The container runs as the unprivileged `node` user; the volume must be writable by UID 1000.

## Local production check

`npm ci && npm run build` then `HOSTNAME=127.0.0.1 PORT=5195 APP_ORIGIN=http://127.0.0.1:5195 DATA_DIR=/tmp/florelle-production-check npm start`. In a second terminal run `TEST_BASE_URL=http://127.0.0.1:5195 npm test`.

A successful build is not a completed public deployment. The store still saves draft orders only and has no payment integration. Typography licensing is recorded in TYPOGRAPHY.md.
