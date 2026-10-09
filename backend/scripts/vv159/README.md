# VV-159: remaining catalog corrections

Audited the 511 unique products in the public catalog (1,000 offers) on 2026-10-09 against their current photographs, Russian/English descriptions, colors and categories. This patch changes only the 26 confirmed contradictions listed in `catalog-corrections.json`. It does not import the old catalog or change IDs, slugs, prices, stock, offers, photographs or order snapshots.

Conflicting names become descriptive names rather than unverified cultivar names. Already corrected descriptions retain their palette and usage text, with the conflicting name replaced. The Blue jumbo mixture becomes Hydrangea mix. Three source photos also contradict their category: Mix moon depicts chrysanthemums, Yellow depicts eustoma, and Large depicts a rose; their categories and species are aligned with those photos. These three original source photographs were checked as well as the current storefront images.

## Run

From the repository root, with the intended database's `DATABASE_URL` supplied securely:

```sh
# Read-only preview. Stops if an audited row has changed.
node backend/scripts/vv159/catalog-corrections.mjs

# Apply all pending corrections in one transaction. Creates a new backup first.
node backend/scripts/vv159/catalog-corrections.mjs --apply --backup=/absolute/path/vv159-before.json

# Restore exact saved values, only while the patched fields still match.
node backend/scripts/vv159/catalog-corrections.mjs --restore --backup=/absolute/path/vv159-before.json
```

The backup path must not already exist. Keep the backup outside the repository. A second apply is a no-op. Both apply and restore abort the entire transaction on a conflict; changes made since the audit must be reviewed, not overwritten. No production data has been modified during preparation.

Verified locally against a separate migrated PostgreSQL database: preview, apply 26, restore 26. Code changes were checked separately with typechecks, builds, unit tests and real PostgreSQL commerce/catalog tests. The pre-existing Arc Pay admission-lock integration failure at `arc-pay.integration.test.ts:416` remains outside this change.
