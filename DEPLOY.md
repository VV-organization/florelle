# Deployment

There are two deployment targets, both using Node.js 24 at build time.

## GitHub Pages storefront

`npm ci && npm run build` produces `out/` for https://vv-organization.github.io/florelle/.
`npm run preview:pages` serves that exact export at http://127.0.0.1:5196/florelle/ (no Next server or SPA fallback).

The storefront supports the catalogue, product/seller pages, search/filtering, retail/wholesale modes, currencies, basket persistence, quick view and delivery estimates. Registration, sign-in and ordering are explicitly unavailable on Pages; their routes display an explanation. No passwords or orders are stored in browser storage. The cart does not offer checkout or payment on Pages.

`.github/workflows/pages.yml` builds on pull requests and pushes to `main`, verifies exported routes and local URLs, and uploads only `out/`. Deployment runs only from `main`, with `pages: write`, `id-token: write` and the `github-pages` environment. Manual dispatch is supported. In repository Settings → Pages, use Source → GitHub Actions (already enabled when checked on 2026-10-01). Push the configuration to `main` to trigger publication; a local build alone does not publish the site.

`basePath: '/florelle'` handles Next links, router navigation and `_next` files. A separate `assetPrefix` is unnecessary (it is intended for a CDN and does not prefix public files). `assetPath()` prefixes image/srcset, WebGL texture, logo, favicon and preload URLs. CSS references are bundled from relative public file imports, so Next prefixes the emitted assets. Retina backgrounds use a resolution media query because this Turbopack version does not resolve file imports inside `image-set()`. `trailingSlash: true` produces directory indexes for direct navigation/reloads. `.nojekyll` is added after verification.

### Static compatibility audit

- `src/app/api/account/route.ts`: GET/POST/PATCH, request bodies, HttpOnly session cookies, password hashing and SQLite — server-only.
- `src/app/api/orders/route.ts`: authenticated reads/writes and server-validated draft orders — server-only.
- `src/app/api/health/route.ts`: dynamic database health probe — server-only.
- `src/lib/database.ts`: Node filesystem/crypto/SQLite and `next/headers` cookies — reachable only from those API handlers.
- No Server Actions (`use server`), middleware/proxy, runtime rewrites/redirects, ISR or optimized `next/image` dependencies were found.
- The catch-all route previously read server `searchParams` and had no `generateStaticParams`. Public routes and all unique product slugs are now enumerated; seller selection is read in a small client query component inside Suspense. Unknown paths receive the static 404. Arbitrary `/orders/:id` and `/payment/:id` remain supported only by the server target.
- Pages discovers only `.tsx` route files via `pageExtensions`; all existing Node API handlers remain `.ts` and are excluded. Keep UI route files `.tsx` and server handlers `.ts`. The postbuild verifier rejects any exported `api` directory. Shared `.ts` libraries still work as ordinary imports.
- `scripts/verify-static-export.mjs` checks every public/product HTML file and local HTML/CSS URL, including image srcsets; it fails on missing files or unprefixed root URLs.

## Full server application

`npm run build:server` retains `output: 'standalone'`, root URLs and every API handler. `npm start` runs that build. `npm run dev` also retains the full server functionality. Build targets share `.next`, so rebuild the desired target before starting it.

The server needs Node.js 24 and a persistent writable SQLite disk. Do not deploy this SQLite configuration to an ephemeral/serverless filesystem.

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

`npm ci && npm run build:server` then `HOSTNAME=127.0.0.1 PORT=5195 APP_ORIGIN=http://127.0.0.1:5195 DATA_DIR=/tmp/florelle-production-check npm start`. In a second terminal run `TEST_BASE_URL=http://127.0.0.1:5195 npm test`.

A successful build is not a completed public deployment. The store still saves draft orders only and has no payment integration. Typography licensing is recorded in TYPOGRAPHY.md.
