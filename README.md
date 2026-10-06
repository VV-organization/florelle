# Florelle

One repository containing the designer frontend and independent commerce backend.

- `frontend/`: Next.js on Node24 storefront; [development instructions](frontend/README.md).
- `backend/`: Fastify/PostgreSQL/Redis API, catalog importer and owned media; [instructions](backend/README.md).
- `docker-compose.yaml`: stage runtime, based on Finext deploy templates.
- `.github/workflows/deploy.yaml`: self-hosted deployment from `main` to `florelle-stage`.

See [DEPLOY.md](DEPLOY.md) for server environment, data initialization and ports. No production secrets are stored in this repository. Local data and source-media exports are excluded from Git.

The Git history is preserved from the original frontend repository. Old commits before the root migration contain frontend files at the repository root; the current tree uses `frontend/` and `backend/`.
