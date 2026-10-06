# Florelle runtime

The frontend is a Next.js standalone server on Node24, alongside the independent Fastify API in `../backend`. Static GitHub Pages and SQLite are no longer runtime targets.

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

Development UI: http://127.0.0.1:5194. `BACKEND_URL` defaults to http://127.0.0.1:5195. Catalog, content, rates, authentication, cart and orders come from the API; `/media` serves the backend's persistent image storage. Next rewrites are compiled at build time.

Use `../docker-compose.yaml` for the complete production bundle and `../DEPLOY.md` for credentials, migrations, import, backups and acceptance checks. Configure real services before enabling checkout. Never deploy the frontend without API/media availability; it has no static commercial-data fallback.

The original designer source and photographs remain reproducible from Git commit130ef91. The API importer stores original bytes and supplied variants in its own media directory.
