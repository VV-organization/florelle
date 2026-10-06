# Catalog module — design spec

**Date:** 2026-04-10
**Module:** `src/modules/catalog` + `src/shared/currency/fx.service.ts`
**Status:** approved (pending implementation)

## 1. Context

The catalog module exposes the public-facing product browsing API for the
B2B flowers marketplace. It is the second feature module after auth. All
five endpoints are public (no authentication required) — auth is only
needed for cart/orders.

Key domain concept: **Product ≠ Listing**. A Product is a flower variety
(e.g., Pink Mondial). A Listing is one seller's offer for that product
with its own price, stock count, and delivery date. The catalog shows
listings to buyers.

The module also introduces the **FxService** — a shared service for
currency conversion that lives in `src/shared/currency/` and will later
be reused by the orders module.

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Scope | All 5 catalog endpoints + FxService | One spec/plan cycle; FxService is shared, simpler endpoints are ~30 lines each |
| Response shape: GET /products | Listing-centric (flat) | Simple pagination, simple SQL, one listing = one card in the UI |
| Response shape: GET /products/:slug | Product-centric (nested listings) | Detail page shows all sellers for one product |
| Auth | Public, no authenticate middleware | B2B buyers browse freely; auth needed only for cart/orders |
| FX strategy | Read-through Redis cache + on-miss API fetch | Compatible with CLAUDE.md constraints (synchronous, USD-only storage) |
| FX fallback chain | Redis → API → DB → rate 1.0 (USD) | Triple fallback without background jobs |
| Price filters | Convert display-currency values to USD before DB query | Preserves index usage on seller_price_usd |
| Price sorting | Sort by seller_price_usd in DB | Relative order invariant under positive FX multiplier |
| New error classes | None needed | Reuse NotFoundError and Zod validation from existing shared code |

## 3. FxService

**File:** `src/shared/currency/fx.service.ts` (replace existing skeleton)

### Constructor

```ts
class FxService {
  constructor(
    private readonly db: Database,
    private readonly redis: RedisClient,
    private readonly config: FxServiceConfig,
  ) {}
}

type FxServiceConfig = {
  apiKey: string;
  baseCurrency: string;   // 'USD'
  cacheTtlSeconds: number; // 3600
};
```

### Public methods

**`getRate(target: string): Promise<number>`**

1. `redis.get('fx:USD:{target}')` → parse float, return if found
2. HTTP GET `https://v6.exchangerate-api.com/v6/{apiKey}/pair/USD/{target}`
   → extract `conversion_rate` from JSON response
3. `redis.set('fx:USD:{target}', rate, 'EX', cacheTtlSeconds)`
4. DB upsert into `exchange_rates` (base, target, rate, fetched_at)
5. Return rate

Fallback chain on errors:
- Redis miss → API fetch (step 2)
- API failure (network, 429, 500) → DB
  `SELECT rate FROM exchange_rates WHERE base='USD' AND target=? ORDER BY fetched_at DESC LIMIT 1`
- DB also empty → rate = 1.0 (return USD as-is)
- Each fallback level logs a warning

**`convert(amountUsd: string, target: string): Promise<string>`**

- If `target === baseCurrency` ('USD') → return `amountUsd` as-is
- Otherwise: `getRate(target)` → `(parseFloat(amountUsd) * rate).toFixed(2)`
- Returns decimal string per CLAUDE.md convention
- If `parseFloat` returns NaN → return `'0.00'` with warning log

### Redis keys

`fx:USD:EUR`, `fx:USD:RUB` — TTL from `FX_CACHE_TTL_SECONDS` env var.

### Supported currencies

`USD`, `EUR`, `RUB` — validated at the router level via Zod enum. FxService
itself does not restrict currencies (passes target as-is to the API).

## 4. Endpoint contracts

All endpoints live under `/api/v1`. No auth required.

### `GET /products`

**Query params** (all optional):

| Param | Type | Description |
|---|---|---|
| `category` | string | Category slug (e.g., `roses`) |
| `seller` | string (UUID) | Seller ID |
| `color` | string | Case-insensitive exact match on product color |
| `min_price` | number | Minimum seller price **in display currency** |
| `max_price` | number | Maximum seller price **in display currency** |
| `delivery_date` | string (date) | Listings delivering on or before this date |
| `sort` | enum | `price_asc`, `price_desc`, `delivery_asc`, `newest` (default: `newest`) |
| `currency` | enum | `USD`, `EUR`, `RUB` (default: `USD`) |
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 20, max: 100) |

**Price filter conversion:** `min_price` and `max_price` arrive in display
currency. Before the DB query, divide by the FX rate to get USD thresholds:
`min_price_usd = min_price / rate`. This preserves index usage on
`listings.seller_price_usd`.

**Sort:** all sort options map to DB ORDER BY on USD columns or date
columns. Sorting by `seller_price_usd` is correct for any display
currency because FX conversion is multiplication by a positive constant
— relative ordering is preserved.

**Query:** single SQL with three JOINs (listings → products → sellers →
categories). Only `is_active = true` listings and products. Separate
`COUNT(*)` query for `meta.total`.

**Response:**

```json
{
  "data": [
    {
      "id": "listing-uuid",
      "product": {
        "id": "product-uuid",
        "name": "Pink Mondial",
        "slug": "pink-mondial",
        "species": "Rose",
        "color": "Pink",
        "imageUrl": "https://...",
        "category": { "name": "Roses", "slug": "roses" }
      },
      "seller": {
        "id": "seller-uuid",
        "name": "Flores de Colombia",
        "country": "CO",
        "verified": true
      },
      "sellerPrice": "10.63",
      "amsPrice": "11.90",
      "boxQuantity": 25,
      "availableStock": 100,
      "deliveryDate": "2026-04-15"
    }
  ],
  "meta": { "total": 142, "page": 1, "limit": 20, "pages": 8 }
}
```

Prices are decimal strings in the requested display currency. `category`
may be `null` if the product has no category assigned.

### `GET /products/:slug`

**Response:**

```json
{
  "id": "product-uuid",
  "name": "Pink Mondial",
  "slug": "pink-mondial",
  "species": "Rose",
  "color": "Pink",
  "stemLengthCm": 60,
  "headSize": "Medium",
  "imageUrl": "https://...",
  "description": "Premium Colombian rose...",
  "category": { "name": "Roses", "slug": "roses" },
  "listings": [
    {
      "id": "listing-uuid",
      "seller": { "id": "...", "name": "...", "country": "CO", "verified": true },
      "sellerPrice": "10.63",
      "amsPrice": "11.90",
      "boxQuantity": 25,
      "availableStock": 100,
      "deliveryDate": "2026-04-15"
    }
  ]
}
```

Query params: `?currency=EUR` (same enum, default USD).

Listings sorted by `seller_price_usd ASC` (cheapest first).

Product not found or `is_active = false` → `404 NOT_FOUND`.

Product exists but has zero active listings → product returned with
`listings: []`.

### `GET /sellers`

**Response:**

```json
{
  "data": [
    {
      "id": "seller-uuid",
      "name": "Flores de Colombia",
      "country": "CO",
      "rating": 4,
      "logoUrl": "https://...",
      "verified": true
    }
  ]
}
```

No pagination (sellers are admin-managed, expected count: tens, not
thousands). No FX conversion (no prices). Sorted by `name ASC`.

### `GET /collections`

**Response:**

```json
{
  "data": [
    {
      "id": "collection-uuid",
      "name": "Valentine's Day",
      "slug": "valentines-day",
      "type": "seasonal",
      "imageUrl": "https://..."
    }
  ]
}
```

Only `is_active = true` collections. Sorted by `sort_order ASC`. No
pagination (collections are curated, expected count: single digits).

### `GET /collections/:slug`

Query params: `?currency=EUR` (same enum).

**Response:**

```json
{
  "id": "collection-uuid",
  "name": "Valentine's Day",
  "slug": "valentines-day",
  "type": "seasonal",
  "imageUrl": "https://...",
  "items": [
    {
      "id": "listing-uuid",
      "product": { "name": "Red Mondial", "slug": "red-mondial", ... },
      "seller": { "id": "...", "name": "...", ... },
      "sellerPrice": "10.63",
      "amsPrice": "11.90",
      "boxQuantity": 25,
      "availableStock": 100,
      "deliveryDate": "2026-04-15",
      "sortOrder": 1
    }
  ]
}
```

Items are listing-centric (same shape as `GET /products` data items) plus
`sortOrder` from the `collection_items` junction table. FX conversion
applied.

Collection not found → `404 NOT_FOUND`. Collection with no items →
`items: []`.

## 5. File structure

### New files

```
src/shared/currency/
├── fx.service.ts                    # FxService (replace skeleton)
└── __tests__/
    └── fx.service.test.ts           # 6 unit tests

src/modules/catalog/
├── catalog.router.ts                # Fastify plugin: 5 routes (replace stub)
├── catalog.service.ts               # CatalogService class
├── catalog.schema.ts                # Zod schemas for query params + responses
├── catalog.queries.ts               # Complex Drizzle join queries
└── __tests__/
    └── catalog.service.test.ts      # 13 unit tests
```

### Modified files

```
src/app.ts    # Create FxService + CatalogService, register catalog router
```

### File responsibilities

**`catalog.queries.ts`** — pure functions that build and execute Drizzle
queries. Each takes `Database` as first argument. Exports:

- `queryListings(db, filters, sort, page, limit)` → `{ rows, total }`
- `queryProductBySlug(db, slug)` → product row + listing rows
- `queryCollectionBySlug(db, slug)` → collection row + item rows

**`catalog.service.ts`** — `CatalogService` class:

```ts
class CatalogService {
  constructor(
    private readonly db: Database,
    private readonly fxService: FxService,
  ) {}

  async getListings(query: ProductsQuery): Promise<PaginatedResponse<ListingItem>>
  async getProductBySlug(slug: string, currency: string): Promise<ProductDetail>
  async getSellers(): Promise<Seller[]>
  async getCollections(): Promise<Collection[]>
  async getCollectionBySlug(slug: string, currency: string): Promise<CollectionDetail>
}
```

Service flow: call query function → get raw rows → call
`fxService.convert()` on price fields → map to response shape → return.

**`catalog.schema.ts`** — Zod schemas + inferred types:

- `productsQuerySchema` — all GET /products query params with defaults
- `currencyQuerySchema` — `z.enum(['USD', 'EUR', 'RUB']).default('USD')`
- `listingItemSchema` — one listing in the list
- `productDetailSchema` — GET /products/:slug response
- `sellerSchema` — one seller
- `collectionSchema` — one collection in the list
- `collectionDetailSchema` — GET /collections/:slug response
- `paginatedResponseSchema(itemSchema)` — generic `{ data, meta }`
- Inferred TypeScript types for all

**`catalog.router.ts`** — factory `buildCatalogRouter(catalogService)`:
5 routes with Zod type provider for query param validation. No business
logic — delegates to service.

### Dependency graph

```
app.ts
  → FxService(db, redis, fxConfig)
  → CatalogService(db, fxService)
  → buildCatalogRouter(catalogService)
```

## 6. Error handling

No new error classes needed. Existing shared errors cover all cases:

- `NotFoundError` (404) — product/collection slug not found or inactive
- Zod `ValidationError` (422) — invalid query params (handled by global
  error handler's ZodError branch)

FxService never throws to callers. Triple fallback guarantees a rate is
always returned. Errors at each level are logged as warnings.

Edge case: `convert()` receives unparseable `amountUsd` (NaN) → returns
`'0.00'` with warning log. This is a defensive guard against upstream
bugs, not a normal path.

## 7. Testing strategy

### FxService — 6 unit tests

File: `src/shared/currency/__tests__/fx.service.test.ts`

Mocks: Redis (`vi.fn`), HTTP fetch (`vi.fn` or `vi.mock` on global
fetch), Database (chainable mock).

1. Cache hit → returns rate from Redis, no API/DB calls
2. Cache miss + API success → caches in Redis + upserts DB, returns rate
3. Cache miss + API failure → DB fallback returns last known rate
4. Cache miss + API failure + DB empty → rate 1.0, warning logged
5. `convert('12.50', 'USD')` → `'12.50'` (no-op, getRate not called)
6. `convert('12.50', 'EUR')` with rate 0.85 → `'10.63'`

### CatalogService — 13 unit tests

File: `src/modules/catalog/__tests__/catalog.service.test.ts`

Mocks: Database (chainable), FxService (`vi.fn` for getRate/convert).

**getListings (6):**
1. Happy path without filters — paginated list with correct meta
2. Category filter (slug) — query applies slug condition
3. Price filter with FX — divides min_price by rate before DB query
4. Sort price_asc — ORDER BY seller_price_usd ASC
5. Empty result (page out of bounds) — `data: []`, `meta.total: 0`
6. `currency=USD` — FxService.convert not called

**getProductBySlug (3):**
7. Happy path — product with listings, prices converted
8. Slug not found → NotFoundError
9. Product is_active=false → NotFoundError

**getSellers (1):**
10. Returns seller list sorted by name

**getCollections (1):**
11. Returns active collections sorted by sort_order

**getCollectionBySlug (2):**
12. Happy path — collection with items, prices converted
13. Slug not found → NotFoundError

**Total: 19 unit tests** (6 FxService + 13 CatalogService).

### Mock strategy for CatalogService

FxService is mocked entirely — it's a dependency, not the thing under
test:

```ts
const fxService = {
  getRate: vi.fn().mockResolvedValue(0.85),
  convert: vi.fn().mockImplementation(
    (amount: string) => Promise.resolve((parseFloat(amount) * 0.85).toFixed(2))
  ),
};
```

Database mock extends the auth pattern with additional chain methods for
JOINs (`innerJoin`, `leftJoin`, `orderBy`, `offset`).

### What we do NOT test

- `catalog.queries.ts` separately — tested through CatalogService
- `catalog.router.ts` — covered by Task 15-style smoke test
- Real DB/Redis — unit tests use mocks only
- FX API integration — fetch is mocked

## 8. Out of scope

- Full-text search by product name (not in CLAUDE.md filter list)
- Seller detail page (`GET /sellers/:id`)
- Collection CRUD (admin creates via DB or future admin endpoints)
- Product image upload (CLAUDE.md: "images are external URLs")
- Price history or analytics
- Listing creation/update (admin endpoints, separate module)
