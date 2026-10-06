# Catalog Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the public-facing catalog API — 5 read-only endpoints for browsing products/listings, sellers, and collections, with multi-currency display via a shared FxService.

**Architecture:** `FxService` (shared, read-through Redis cache with triple fallback) provides currency conversion. `CatalogService` orchestrates Drizzle queries (extracted into `catalog.queries.ts`) and FX conversion. Router is a thin Fastify plugin. All endpoints are public (no auth). Prices stored in USD, converted at read time, returned as decimal strings.

**Tech Stack:** Fastify 4, `fastify-type-provider-zod`, Drizzle ORM + `postgres.js`, `ioredis`, Zod 3, Vitest. External dependency: exchangerate-api.com (for FX rates).

**Spec:** [`backend/docs/superpowers/specs/2026-04-10-catalog-module-design.md`](../specs/2026-04-10-catalog-module-design.md)

**Assumed workdir for all commands:** `flowers/backend/`.

---

## File structure

| File | Action | Purpose |
|---|---|---|
| `src/shared/currency/fx.service.ts` | Rewrite (currently skeleton) | FxService: getRate + convert with Redis/API/DB fallback |
| `src/shared/currency/__tests__/fx.service.test.ts` | Create | 6 unit tests for FxService |
| `src/modules/catalog/catalog.schema.ts` | Create | Zod schemas for query params + response shapes |
| `src/modules/catalog/catalog.queries.ts` | Create | Pure Drizzle query functions (complex JOINs) |
| `src/modules/catalog/catalog.service.ts` | Create | CatalogService class — 5 methods |
| `src/modules/catalog/__tests__/catalog.service.test.ts` | Create | 13 unit tests for CatalogService |
| `src/modules/catalog/catalog.router.ts` | Rewrite (currently stub) | 5 Fastify routes |
| `src/app.ts` | Modify | Create FxService + CatalogService, register catalog router |

---

## Task 1: Create `catalog.schema.ts`

**Files:**
- Create: `src/modules/catalog/catalog.schema.ts`

- [ ] **Step 1: Create the schema file**

Create `src/modules/catalog/catalog.schema.ts`:
```ts
import { z } from 'zod';

export const currencySchema = z.enum(['USD', 'EUR', 'RUB']).default('USD');

export const productsQuerySchema = z.object({
  category: z.string().optional(),
  seller: z.string().uuid().optional(),
  color: z.string().optional(),
  min_price: z.coerce.number().nonnegative().optional(),
  max_price: z.coerce.number().nonnegative().optional(),
  delivery_date: z.string().date().optional(),
  sort: z
    .enum(['price_asc', 'price_desc', 'delivery_asc', 'newest'])
    .default('newest'),
  currency: currencySchema,
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const slugParamSchema = z.object({
  slug: z.string().min(1),
});

export const currencyQuerySchema = z.object({
  currency: currencySchema,
});

const categoryRefSchema = z
  .object({ name: z.string(), slug: z.string() })
  .nullable();

const sellerRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  country: z.string(),
  verified: z.boolean(),
});

const productRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  species: z.string(),
  color: z.string(),
  imageUrl: z.string(),
  category: categoryRefSchema,
});

export const listingItemSchema = z.object({
  id: z.string().uuid(),
  product: productRefSchema,
  seller: sellerRefSchema,
  sellerPrice: z.string(),
  amsPrice: z.string(),
  boxQuantity: z.number().int(),
  availableStock: z.number().int(),
  deliveryDate: z.string(),
});

export const paginationMetaSchema = z.object({
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
  pages: z.number().int(),
});

export const paginatedListingsSchema = z.object({
  data: z.array(listingItemSchema),
  meta: paginationMetaSchema,
});

export const productDetailSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  species: z.string(),
  color: z.string(),
  stemLengthCm: z.number().int().nullable(),
  headSize: z.string().nullable(),
  imageUrl: z.string(),
  description: z.string().nullable(),
  category: categoryRefSchema,
  listings: z.array(
    z.object({
      id: z.string().uuid(),
      seller: sellerRefSchema,
      sellerPrice: z.string(),
      amsPrice: z.string(),
      boxQuantity: z.number().int(),
      availableStock: z.number().int(),
      deliveryDate: z.string(),
    }),
  ),
});

export const sellerSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  country: z.string(),
  rating: z.number().int(),
  logoUrl: z.string().nullable(),
  verified: z.boolean(),
});

export const sellersResponseSchema = z.object({
  data: z.array(sellerSchema),
});

export const collectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  type: z.enum(['promo', 'seasonal', 'editorial']),
  imageUrl: z.string().nullable(),
});

export const collectionsResponseSchema = z.object({
  data: z.array(collectionSchema),
});

export const collectionDetailSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  type: z.enum(['promo', 'seasonal', 'editorial']),
  imageUrl: z.string().nullable(),
  items: z.array(
    listingItemSchema.extend({ sortOrder: z.number().int() }),
  ),
});

export type ProductsQuery = z.infer<typeof productsQuerySchema>;
export type ListingItem = z.infer<typeof listingItemSchema>;
export type ProductDetail = z.infer<typeof productDetailSchema>;
export type Seller = z.infer<typeof sellerSchema>;
export type Collection = z.infer<typeof collectionSchema>;
export type CollectionDetail = z.infer<typeof collectionDetailSchema>;
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: pass.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/modules/catalog/catalog.schema.ts
git commit -m "feat(backend/catalog): Zod schemas for catalog query params and responses"
```

---

## Task 2: FxService — full implementation + 6 TDD tests

**Files:**
- Rewrite: `src/shared/currency/fx.service.ts`
- Create: `src/shared/currency/__tests__/fx.service.test.ts`

- [ ] **Step 1: Create the test file with mocks and first test (cache hit)**

Create `src/shared/currency/__tests__/fx.service.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FxService, type FxServiceConfig } from '../fx.service';
import type { Database } from '../../db/client';
import type { RedisClient } from '../../redis/client';

function createDbMock() {
  const db = {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    target: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  return db as unknown as Database & typeof db;
}

function createRedisMock() {
  const redis = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  };
  return redis as unknown as RedisClient & typeof redis;
}

const mockFetch = vi.fn();

const testConfig: FxServiceConfig = {
  apiKey: 'test-api-key',
  baseCurrency: 'USD',
  cacheTtlSeconds: 3600,
  fetchFn: mockFetch,
};

describe('FxService', () => {
  let db: ReturnType<typeof createDbMock>;
  let redis: ReturnType<typeof createRedisMock>;
  let service: FxService;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createDbMock();
    redis = createRedisMock();
    service = new FxService(db, redis, testConfig);
  });

  describe('getRate', () => {
    it('returns cached rate from Redis without hitting API or DB', async () => {
      redis.get.mockResolvedValue('0.85');

      const rate = await service.getRate('EUR');

      expect(rate).toBe(0.85);
      expect(redis.get).toHaveBeenCalledWith('fx:USD:EUR');
      expect(mockFetch).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Rewrite `fx.service.ts` with full implementation**

Replace `src/shared/currency/fx.service.ts` entirely:
```ts
import type { Database } from '../db/client';
import type { RedisClient } from '../redis/client';
import { exchangeRates } from '../db/schema/exchange-rates';
import { eq, and, desc } from 'drizzle-orm';

export type FxServiceConfig = {
  apiKey: string;
  baseCurrency: string;
  cacheTtlSeconds: number;
  fetchFn?: typeof fetch;
};

export class FxService {
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly db: Database,
    private readonly redis: RedisClient,
    private readonly config: FxServiceConfig,
  ) {
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async getRate(target: string): Promise<number> {
    if (target === this.config.baseCurrency) return 1;

    const cacheKey = `fx:${this.config.baseCurrency}:${target}`;

    // 1. Try Redis
    const cached = await this.redis.get(cacheKey);
    if (cached !== null) {
      const rate = parseFloat(cached);
      if (!isNaN(rate)) return rate;
    }

    // 2. Try external API
    try {
      const url = `https://v6.exchangerate-api.com/v6/${this.config.apiKey}/pair/${this.config.baseCurrency}/${target}`;
      const response = await this.fetchFn(url);
      if (response.ok) {
        const data = (await response.json()) as { conversion_rate?: number };
        if (typeof data.conversion_rate === 'number') {
          const rate = data.conversion_rate;
          // Cache in Redis
          await this.redis.set(cacheKey, String(rate), 'EX', this.config.cacheTtlSeconds);
          // Persist in DB for fallback
          await this.upsertRate(target, rate);
          return rate;
        }
      }
    } catch {
      // API failed — fall through to DB
    }

    // 3. Try DB (last known rate)
    try {
      const rows = await this.db
        .select({ rate: exchangeRates.rate })
        .from(exchangeRates)
        .where(
          and(
            eq(exchangeRates.base, this.config.baseCurrency),
            eq(exchangeRates.target, target),
          ),
        )
        .orderBy(desc(exchangeRates.fetchedAt))
        .limit(1);

      const row = rows[0];
      if (row) {
        const rate = parseFloat(row.rate);
        if (!isNaN(rate)) {
          // Re-cache in Redis
          await this.redis.set(cacheKey, String(rate), 'EX', this.config.cacheTtlSeconds);
          return rate;
        }
      }
    } catch {
      // DB also failed — fall through to default
    }

    // 4. Ultimate fallback
    return 1;
  }

  async convert(amountUsd: string, target: string): Promise<string> {
    if (target === this.config.baseCurrency) return amountUsd;
    const rate = await this.getRate(target);
    const amount = parseFloat(amountUsd);
    if (isNaN(amount)) return '0.00';
    return (amount * rate).toFixed(2);
  }

  private async upsertRate(target: string, rate: number): Promise<void> {
    try {
      await this.db
        .insert(exchangeRates)
        .values({
          base: this.config.baseCurrency,
          target,
          rate: String(rate),
        })
        .onConflictDoUpdate({
          target: [exchangeRates.base, exchangeRates.target],
          set: {
            rate: String(rate),
            fetchedAt: new Date(),
          },
        });
    } catch {
      // Non-critical — log and continue
    }
  }
}
```

- [ ] **Step 3: Run first test — should pass**

```bash
pnpm test -- --grep "FxService"
```
Expected: 1 test passes.

- [ ] **Step 4: Add remaining 5 tests**

Add inside `describe('FxService')`:
```ts
    it('fetches from API on cache miss, caches in Redis and DB', async () => {
      redis.get.mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ conversion_rate: 0.85 }),
      });

      const rate = await service.getRate('EUR');

      expect(rate).toBe(0.85);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://v6.exchangerate-api.com/v6/test-api-key/pair/USD/EUR',
      );
      expect(redis.set).toHaveBeenCalledWith('fx:USD:EUR', '0.85', 'EX', 3600);
      expect(db.insert).toHaveBeenCalled();
    });

    it('falls back to DB when API fails', async () => {
      redis.get.mockResolvedValue(null);
      mockFetch.mockRejectedValue(new Error('network error'));
      db.limit.mockResolvedValue([{ rate: '0.82' }]);

      const rate = await service.getRate('EUR');

      expect(rate).toBe(0.82);
      expect(redis.set).toHaveBeenCalledWith('fx:USD:EUR', '0.82', 'EX', 3600);
    });

    it('returns 1.0 when Redis, API, and DB all fail', async () => {
      redis.get.mockResolvedValue(null);
      mockFetch.mockRejectedValue(new Error('network error'));
      db.limit.mockResolvedValue([]);

      const rate = await service.getRate('EUR');

      expect(rate).toBe(1);
    });
  });

  describe('convert', () => {
    it('returns amountUsd as-is when target is USD', async () => {
      const result = await service.convert('12.50', 'USD');

      expect(result).toBe('12.50');
      expect(redis.get).not.toHaveBeenCalled();
    });

    it('converts amount using fetched rate', async () => {
      redis.get.mockResolvedValue('0.85');

      const result = await service.convert('12.50', 'EUR');

      expect(result).toBe('10.63');
    });
```

- [ ] **Step 5: Run all FxService tests**

```bash
pnpm test -- --grep "FxService"
```
Expected: 6 tests pass.

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/shared/currency/fx.service.ts backend/src/shared/currency/__tests__/fx.service.test.ts
git commit -m "feat(backend): FxService with read-through cache and triple fallback

Implements getRate (Redis → API → DB → 1.0) and convert (decimal
string output). 6 unit tests covering all fallback paths."
```

---

## Task 3: Create `catalog.queries.ts`

**Files:**
- Create: `src/modules/catalog/catalog.queries.ts`

- [ ] **Step 1: Create the queries file**

Create `src/modules/catalog/catalog.queries.ts`:
```ts
import {
  eq,
  and,
  asc,
  desc,
  lte,
  gte,
  ilike,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { Database } from '../../shared/db/client';
import { listings } from '../../shared/db/schema/listings';
import { products } from '../../shared/db/schema/products';
import { sellers } from '../../shared/db/schema/sellers';
import { categories } from '../../shared/db/schema/products';
import { collections, collectionItems } from '../../shared/db/schema/collections';

export type ListingFilters = {
  categorySlug?: string;
  sellerId?: string;
  color?: string;
  minPriceUsd?: number;
  maxPriceUsd?: number;
  deliveryDate?: string;
};

export type SortOption = 'price_asc' | 'price_desc' | 'delivery_asc' | 'newest';

export async function queryListings(
  db: Database,
  filters: ListingFilters,
  sort: SortOption,
  page: number,
  limit: number,
): Promise<{ rows: ListingRow[]; total: number }> {
  const conditions: SQL[] = [
    eq(listings.isActive, true),
    eq(products.isActive, true),
  ];

  if (filters.categorySlug) {
    conditions.push(eq(categories.slug, filters.categorySlug));
  }
  if (filters.sellerId) {
    conditions.push(eq(listings.sellerId, filters.sellerId));
  }
  if (filters.color) {
    conditions.push(ilike(products.color, filters.color));
  }
  if (filters.minPriceUsd !== undefined) {
    conditions.push(gte(listings.sellerPriceUsd, String(filters.minPriceUsd)));
  }
  if (filters.maxPriceUsd !== undefined) {
    conditions.push(lte(listings.sellerPriceUsd, String(filters.maxPriceUsd)));
  }
  if (filters.deliveryDate) {
    conditions.push(lte(listings.deliveryDate, filters.deliveryDate));
  }

  const whereClause = and(...conditions)!;

  const orderByClause = {
    price_asc: asc(listings.sellerPriceUsd),
    price_desc: desc(listings.sellerPriceUsd),
    delivery_asc: asc(listings.deliveryDate),
    newest: desc(listings.createdAt),
  }[sort];

  const baseQuery = db
    .select({
      listingId: listings.id,
      sellerPriceUsd: listings.sellerPriceUsd,
      amsPriceUsd: listings.amsPriceUsd,
      boxQuantity: listings.boxQuantity,
      availableStock: listings.availableStock,
      deliveryDate: listings.deliveryDate,
      productId: products.id,
      productName: products.name,
      productSlug: products.slug,
      productSpecies: products.species,
      productColor: products.color,
      productImageUrl: products.imageUrl,
      sellerId: sellers.id,
      sellerName: sellers.name,
      sellerCountry: sellers.country,
      sellerVerified: sellers.verified,
      categoryName: categories.name,
      categorySlug: categories.slug,
    })
    .from(listings)
    .innerJoin(products, eq(listings.productId, products.id))
    .innerJoin(sellers, eq(listings.sellerId, sellers.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(whereClause)
    .orderBy(orderByClause)
    .limit(limit)
    .offset((page - 1) * limit);

  const countQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(listings)
    .innerJoin(products, eq(listings.productId, products.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(whereClause);

  const [rows, countResult] = await Promise.all([baseQuery, countQuery]);
  const total = countResult[0]?.count ?? 0;

  return { rows: rows as ListingRow[], total };
}

export type ListingRow = {
  listingId: string;
  sellerPriceUsd: string;
  amsPriceUsd: string;
  boxQuantity: number;
  availableStock: number;
  deliveryDate: string;
  productId: string;
  productName: string;
  productSlug: string;
  productSpecies: string;
  productColor: string;
  productImageUrl: string;
  sellerId: string;
  sellerName: string;
  sellerCountry: string;
  sellerVerified: boolean;
  categoryName: string | null;
  categorySlug: string | null;
};

export async function queryProductBySlug(
  db: Database,
  slug: string,
): Promise<{ product: ProductRow | null; listings: ProductListingRow[] }> {
  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      species: products.species,
      color: products.color,
      stemLengthCm: products.stemLengthCm,
      headSize: products.headSize,
      imageUrl: products.imageUrl,
      description: products.description,
      categoryName: categories.name,
      categorySlug: categories.slug,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(products.slug, slug), eq(products.isActive, true)))
    .limit(1);

  const product = productRows[0] ?? null;
  if (!product) return { product: null, listings: [] };

  const listingRows = await db
    .select({
      id: listings.id,
      sellerPriceUsd: listings.sellerPriceUsd,
      amsPriceUsd: listings.amsPriceUsd,
      boxQuantity: listings.boxQuantity,
      availableStock: listings.availableStock,
      deliveryDate: listings.deliveryDate,
      sellerId: sellers.id,
      sellerName: sellers.name,
      sellerCountry: sellers.country,
      sellerVerified: sellers.verified,
    })
    .from(listings)
    .innerJoin(sellers, eq(listings.sellerId, sellers.id))
    .where(
      and(eq(listings.productId, product.id), eq(listings.isActive, true)),
    )
    .orderBy(asc(listings.sellerPriceUsd));

  return { product: product as ProductRow, listings: listingRows as ProductListingRow[] };
}

export type ProductRow = {
  id: string;
  name: string;
  slug: string;
  species: string;
  color: string;
  stemLengthCm: number | null;
  headSize: string | null;
  imageUrl: string;
  description: string | null;
  categoryName: string | null;
  categorySlug: string | null;
};

export type ProductListingRow = {
  id: string;
  sellerPriceUsd: string;
  amsPriceUsd: string;
  boxQuantity: number;
  availableStock: number;
  deliveryDate: string;
  sellerId: string;
  sellerName: string;
  sellerCountry: string;
  sellerVerified: boolean;
};

export async function queryCollectionBySlug(
  db: Database,
  slug: string,
): Promise<{ collection: CollectionRow | null; items: CollectionItemRow[] }> {
  const collectionRows = await db
    .select({
      id: collections.id,
      name: collections.name,
      slug: collections.slug,
      type: collections.type,
      imageUrl: collections.imageUrl,
    })
    .from(collections)
    .where(and(eq(collections.slug, slug), eq(collections.isActive, true)))
    .limit(1);

  const collection = collectionRows[0] ?? null;
  if (!collection) return { collection: null, items: [] };

  const itemRows = await db
    .select({
      listingId: listings.id,
      sellerPriceUsd: listings.sellerPriceUsd,
      amsPriceUsd: listings.amsPriceUsd,
      boxQuantity: listings.boxQuantity,
      availableStock: listings.availableStock,
      deliveryDate: listings.deliveryDate,
      productId: products.id,
      productName: products.name,
      productSlug: products.slug,
      productSpecies: products.species,
      productColor: products.color,
      productImageUrl: products.imageUrl,
      sellerId: sellers.id,
      sellerName: sellers.name,
      sellerCountry: sellers.country,
      sellerVerified: sellers.verified,
      categoryName: categories.name,
      categorySlug: categories.slug,
      sortOrder: collectionItems.sortOrder,
    })
    .from(collectionItems)
    .innerJoin(listings, eq(collectionItems.listingId, listings.id))
    .innerJoin(products, eq(listings.productId, products.id))
    .innerJoin(sellers, eq(listings.sellerId, sellers.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        eq(collectionItems.collectionId, collection.id),
        eq(listings.isActive, true),
      ),
    )
    .orderBy(asc(collectionItems.sortOrder));

  return { collection: collection as CollectionRow, items: itemRows as CollectionItemRow[] };
}

export type CollectionRow = {
  id: string;
  name: string;
  slug: string;
  type: 'promo' | 'seasonal' | 'editorial';
  imageUrl: string | null;
};

export type CollectionItemRow = ListingRow & { sortOrder: number };
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

If `categories` is not exported from `products.ts`, add the export. If Drizzle's `ilike` or other operators cause type issues, adjust imports. Fix any compilation errors before proceeding.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/modules/catalog/catalog.queries.ts
git commit -m "feat(backend/catalog): Drizzle query functions with complex JOINs

Three query functions: queryListings (4-table JOIN with dynamic filters,
sort, pagination + COUNT), queryProductBySlug (product + listings),
queryCollectionBySlug (collection → items → listings + products + sellers)."
```

---

## Task 4: CatalogService scaffold + getListings() — TDD

**Files:**
- Create: `src/modules/catalog/catalog.service.ts`
- Create: `src/modules/catalog/__tests__/catalog.service.test.ts`

- [ ] **Step 1: Create `catalog.service.ts` skeleton**

```ts
import type { Database } from '../../shared/db/client';
import type { FxService } from '../../shared/currency/fx.service';
import type {
  ProductsQuery,
  ListingItem,
  ProductDetail,
  CollectionDetail,
  PaginationMeta,
} from './catalog.schema';
import type { Seller, Collection } from './catalog.schema';
import {
  queryListings,
  queryProductBySlug,
  queryCollectionBySlug,
  type ListingRow,
} from './catalog.queries';
import { sellers } from '../../shared/db/schema/sellers';
import { collections } from '../../shared/db/schema/collections';
import { asc, eq } from 'drizzle-orm';
import { NotFoundError } from '../../shared/middleware/error.middleware';

export class CatalogService {
  constructor(
    private readonly db: Database,
    private readonly fxService: FxService,
  ) {}

  async getListings(
    query: ProductsQuery,
  ): Promise<{ data: ListingItem[]; meta: PaginationMeta }> {
    const rate =
      query.currency === 'USD' ? 1 : await this.fxService.getRate(query.currency);

    const filters = {
      categorySlug: query.category,
      sellerId: query.seller,
      color: query.color,
      minPriceUsd:
        query.min_price !== undefined ? query.min_price / rate : undefined,
      maxPriceUsd:
        query.max_price !== undefined ? query.max_price / rate : undefined,
      deliveryDate: query.delivery_date,
    };

    const { rows, total } = await queryListings(
      this.db,
      filters,
      query.sort,
      query.page,
      query.limit,
    );

    const data = await Promise.all(
      rows.map((row) => this.mapListingRow(row, query.currency)),
    );

    return {
      data,
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        pages: Math.ceil(total / query.limit),
      },
    };
  }

  async getProductBySlug(
    slug: string,
    currency: string,
  ): Promise<ProductDetail> {
    const { product, listings } = await queryProductBySlug(this.db, slug);
    if (!product) throw new NotFoundError('Product not found');

    const convertedListings = await Promise.all(
      listings.map(async (l) => ({
        id: l.id,
        seller: {
          id: l.sellerId,
          name: l.sellerName,
          country: l.sellerCountry,
          verified: l.sellerVerified,
        },
        sellerPrice: await this.fxService.convert(l.sellerPriceUsd, currency),
        amsPrice: await this.fxService.convert(l.amsPriceUsd, currency),
        boxQuantity: l.boxQuantity,
        availableStock: l.availableStock,
        deliveryDate: l.deliveryDate,
      })),
    );

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      species: product.species,
      color: product.color,
      stemLengthCm: product.stemLengthCm,
      headSize: product.headSize,
      imageUrl: product.imageUrl,
      description: product.description,
      category: product.categoryName
        ? { name: product.categoryName, slug: product.categorySlug! }
        : null,
      listings: convertedListings,
    };
  }

  async getSellers(): Promise<Seller[]> {
    const rows = await this.db
      .select()
      .from(sellers)
      .orderBy(asc(sellers.name));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      country: r.country,
      rating: r.rating,
      logoUrl: r.logoUrl,
      verified: r.verified,
    }));
  }

  async getCollections(): Promise<Collection[]> {
    const rows = await this.db
      .select()
      .from(collections)
      .where(eq(collections.isActive, true))
      .orderBy(asc(collections.sortOrder));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      type: r.type,
      imageUrl: r.imageUrl,
    }));
  }

  async getCollectionBySlug(
    slug: string,
    currency: string,
  ): Promise<CollectionDetail> {
    const { collection, items } = await queryCollectionBySlug(this.db, slug);
    if (!collection) throw new NotFoundError('Collection not found');

    const convertedItems = await Promise.all(
      items.map(async (item) => ({
        ...(await this.mapListingRow(item, currency)),
        sortOrder: item.sortOrder,
      })),
    );

    return {
      id: collection.id,
      name: collection.name,
      slug: collection.slug,
      type: collection.type,
      imageUrl: collection.imageUrl,
      items: convertedItems,
    };
  }

  private async mapListingRow(
    row: ListingRow,
    currency: string,
  ): Promise<ListingItem> {
    return {
      id: row.listingId,
      product: {
        id: row.productId,
        name: row.productName,
        slug: row.productSlug,
        species: row.productSpecies,
        color: row.productColor,
        imageUrl: row.productImageUrl,
        category: row.categoryName
          ? { name: row.categoryName, slug: row.categorySlug! }
          : null,
      },
      seller: {
        id: row.sellerId,
        name: row.sellerName,
        country: row.sellerCountry,
        verified: row.sellerVerified,
      },
      sellerPrice: await this.fxService.convert(row.sellerPriceUsd, currency),
      amsPrice: await this.fxService.convert(row.amsPriceUsd, currency),
      boxQuantity: row.boxQuantity,
      availableStock: row.availableStock,
      deliveryDate: row.deliveryDate,
    };
  }
}
```

**Important:** The `getCollections` method has a placeholder `where()` call — fix it by adding `import { eq } from 'drizzle-orm'` at the top and using `eq(collections.isActive, true)` inside the where clause. The skeleton above is intentionally showing the structure; the implementer must ensure all imports and the where clause are correct.

- [ ] **Step 2: Create test file with mocks + first 3 getListings tests**

Create `src/modules/catalog/__tests__/catalog.service.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CatalogService } from '../catalog.service';
import type { Database } from '../../../shared/db/client';
import type { FxService } from '../../../shared/currency/fx.service';

vi.mock('../catalog.queries', () => ({
  queryListings: vi.fn(),
  queryProductBySlug: vi.fn(),
  queryCollectionBySlug: vi.fn(),
}));

import { queryListings, queryProductBySlug, queryCollectionBySlug } from '../catalog.queries';

function createDbMock() {
  const db = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  return db as unknown as Database & typeof db;
}

function createFxMock() {
  return {
    getRate: vi.fn().mockResolvedValue(0.85),
    convert: vi.fn().mockImplementation(
      (amount: string) => Promise.resolve((parseFloat(amount) * 0.85).toFixed(2)),
    ),
  } as unknown as FxService & {
    getRate: ReturnType<typeof vi.fn>;
    convert: ReturnType<typeof vi.fn>;
  };
}

const sampleListingRow = {
  listingId: '00000000-0000-0000-0000-000000000001',
  sellerPriceUsd: '12.50',
  amsPriceUsd: '14.00',
  boxQuantity: 25,
  availableStock: 100,
  deliveryDate: '2026-04-15',
  productId: '00000000-0000-0000-0000-000000000010',
  productName: 'Pink Mondial',
  productSlug: 'pink-mondial',
  productSpecies: 'Rose',
  productColor: 'Pink',
  productImageUrl: 'https://example.com/pink.jpg',
  sellerId: '00000000-0000-0000-0000-000000000100',
  sellerName: 'Flores de Colombia',
  sellerCountry: 'CO',
  sellerVerified: true,
  categoryName: 'Roses',
  categorySlug: 'roses',
};

describe('CatalogService', () => {
  let db: ReturnType<typeof createDbMock>;
  let fx: ReturnType<typeof createFxMock>;
  let service: CatalogService;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createDbMock();
    fx = createFxMock();
    service = new CatalogService(db, fx);
  });

  describe('getListings', () => {
    it('returns paginated listings with correct meta', async () => {
      vi.mocked(queryListings).mockResolvedValue({
        rows: [sampleListingRow],
        total: 42,
      });

      const result = await service.getListings({
        sort: 'newest',
        currency: 'EUR',
        page: 2,
        limit: 20,
      });

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        total: 42,
        page: 2,
        limit: 20,
        pages: 3,
      });
    });

    it('converts min_price/max_price to USD before query', async () => {
      vi.mocked(queryListings).mockResolvedValue({ rows: [], total: 0 });
      fx.getRate.mockResolvedValue(0.85);

      await service.getListings({
        min_price: 10,
        max_price: 20,
        sort: 'newest',
        currency: 'EUR',
        page: 1,
        limit: 20,
      });

      const callArgs = vi.mocked(queryListings).mock.calls[0]!;
      const filters = callArgs[1];
      expect(filters.minPriceUsd).toBeCloseTo(10 / 0.85, 5);
      expect(filters.maxPriceUsd).toBeCloseTo(20 / 0.85, 5);
    });

    it('skips FX when currency is USD', async () => {
      vi.mocked(queryListings).mockResolvedValue({ rows: [], total: 0 });

      await service.getListings({
        sort: 'newest',
        currency: 'USD',
        page: 1,
        limit: 20,
      });

      expect(fx.getRate).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm test
```
Expected: 3 new CatalogService tests + 6 FxService + 26 auth = 35 total.

- [ ] **Step 4: Add remaining 3 getListings tests**

```ts
    it('passes category filter as slug', async () => {
      vi.mocked(queryListings).mockResolvedValue({ rows: [], total: 0 });

      await service.getListings({
        category: 'roses',
        sort: 'newest',
        currency: 'USD',
        page: 1,
        limit: 20,
      });

      const callArgs = vi.mocked(queryListings).mock.calls[0]!;
      expect(callArgs[1].categorySlug).toBe('roses');
    });

    it('returns empty data with total 0 when no results', async () => {
      vi.mocked(queryListings).mockResolvedValue({ rows: [], total: 0 });

      const result = await service.getListings({
        sort: 'newest',
        currency: 'USD',
        page: 999,
        limit: 20,
      });

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });

    it('maps listing row to correct response shape', async () => {
      vi.mocked(queryListings).mockResolvedValue({
        rows: [sampleListingRow],
        total: 1,
      });
      fx.convert.mockImplementation((amount: string) =>
        Promise.resolve(amount),
      );

      const result = await service.getListings({
        sort: 'newest',
        currency: 'USD',
        page: 1,
        limit: 20,
      });

      const item = result.data[0]!;
      expect(item.id).toBe(sampleListingRow.listingId);
      expect(item.product.name).toBe('Pink Mondial');
      expect(item.product.category).toEqual({ name: 'Roses', slug: 'roses' });
      expect(item.seller.name).toBe('Flores de Colombia');
      expect(item.sellerPrice).toBe('12.50');
    });
```

- [ ] **Step 5: Run all tests + typecheck**

```bash
pnpm test
pnpm typecheck
```
Expected: 38 total (6 getListings + 6 FxService + 26 auth), typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/modules/catalog/catalog.service.ts backend/src/modules/catalog/__tests__/catalog.service.test.ts
git commit -m "feat(backend/catalog): CatalogService with getListings() — 6 TDD tests

Listing retrieval with FX conversion, price filter USD-normalization,
pagination meta calculation, and correct response shape mapping."
```

---

## Task 5: CatalogService.getProductBySlug() — TDD

**Files:**
- Modify: `src/modules/catalog/__tests__/catalog.service.test.ts`

- [ ] **Step 1: Add 3 tests for getProductBySlug**

Inside `describe('CatalogService')`, add:
```ts
  describe('getProductBySlug', () => {
    const sampleProduct = {
      id: '00000000-0000-0000-0000-000000000010',
      name: 'Pink Mondial',
      slug: 'pink-mondial',
      species: 'Rose',
      color: 'Pink',
      stemLengthCm: 60,
      headSize: 'Medium',
      imageUrl: 'https://example.com/pink.jpg',
      description: 'Premium rose',
      categoryName: 'Roses',
      categorySlug: 'roses',
    };

    const sampleProductListing = {
      id: '00000000-0000-0000-0000-000000000001',
      sellerPriceUsd: '12.50',
      amsPriceUsd: '14.00',
      boxQuantity: 25,
      availableStock: 100,
      deliveryDate: '2026-04-15',
      sellerId: '00000000-0000-0000-0000-000000000100',
      sellerName: 'Flores de Colombia',
      sellerCountry: 'CO',
      sellerVerified: true,
    };

    it('returns product with converted listing prices', async () => {
      vi.mocked(queryProductBySlug).mockResolvedValue({
        product: sampleProduct,
        listings: [sampleProductListing],
      });

      const result = await service.getProductBySlug('pink-mondial', 'EUR');

      expect(result.name).toBe('Pink Mondial');
      expect(result.category).toEqual({ name: 'Roses', slug: 'roses' });
      expect(result.listings).toHaveLength(1);
      expect(fx.convert).toHaveBeenCalledWith('12.50', 'EUR');
    });

    it('throws NotFoundError when slug does not exist', async () => {
      vi.mocked(queryProductBySlug).mockResolvedValue({
        product: null,
        listings: [],
      });

      await expect(
        service.getProductBySlug('nonexistent', 'USD'),
      ).rejects.toThrow('Product not found');
    });

    it('returns product with empty listings array when no active listings', async () => {
      vi.mocked(queryProductBySlug).mockResolvedValue({
        product: sampleProduct,
        listings: [],
      });

      const result = await service.getProductBySlug('pink-mondial', 'USD');

      expect(result.listings).toEqual([]);
    });
  });
```

- [ ] **Step 2: Run tests**

```bash
pnpm test
```
Expected: 41 total (6 + 3 + 6 + 26).

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/modules/catalog/__tests__/catalog.service.test.ts
git commit -m "feat(backend/catalog): getProductBySlug() — 3 TDD tests

Happy path with FX conversion, NotFoundError for missing slug,
and empty listings array when product has no active offers."
```

---

## Task 6: CatalogService remaining methods — TDD

**Files:**
- Modify: `src/modules/catalog/__tests__/catalog.service.test.ts`

- [ ] **Step 1: Add 4 tests for getSellers, getCollections, getCollectionBySlug**

```ts
  describe('getSellers', () => {
    it('returns all sellers sorted by name', async () => {
      const sellerRow = {
        id: '00000000-0000-0000-0000-000000000100',
        name: 'Flores de Colombia',
        country: 'CO',
        rating: 4,
        logoUrl: 'https://example.com/logo.png',
        verified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      db.orderBy.mockResolvedValue([sellerRow]);

      const result = await service.getSellers();

      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe('Flores de Colombia');
      expect(fx.convert).not.toHaveBeenCalled();
    });
  });

  describe('getCollections', () => {
    it('returns active collections sorted by sortOrder', async () => {
      const collectionRow = {
        id: '00000000-0000-0000-0000-000000001000',
        name: "Valentine's Day",
        slug: 'valentines-day',
        type: 'seasonal' as const,
        imageUrl: 'https://example.com/val.jpg',
        isActive: true,
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      db.orderBy.mockResolvedValue([collectionRow]);

      const result = await service.getCollections();

      expect(result).toHaveLength(1);
      expect(result[0]!.slug).toBe('valentines-day');
    });
  });

  describe('getCollectionBySlug', () => {
    it('returns collection with converted item prices', async () => {
      vi.mocked(queryCollectionBySlug).mockResolvedValue({
        collection: {
          id: '00000000-0000-0000-0000-000000001000',
          name: "Valentine's Day",
          slug: 'valentines-day',
          type: 'seasonal',
          imageUrl: null,
        },
        items: [{ ...sampleListingRow, sortOrder: 1 }],
      });

      const result = await service.getCollectionBySlug('valentines-day', 'EUR');

      expect(result.name).toBe("Valentine's Day");
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.sortOrder).toBe(1);
      expect(fx.convert).toHaveBeenCalled();
    });

    it('throws NotFoundError when collection slug does not exist', async () => {
      vi.mocked(queryCollectionBySlug).mockResolvedValue({
        collection: null,
        items: [],
      });

      await expect(
        service.getCollectionBySlug('nonexistent', 'USD'),
      ).rejects.toThrow('Collection not found');
    });
  });
```

- [ ] **Step 2: Run all tests + typecheck**

```bash
pnpm test
pnpm typecheck
```
Expected: 45 total (6 + 6 + 3 + 4 + 26), typecheck clean.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/modules/catalog/__tests__/catalog.service.test.ts
git commit -m "feat(backend/catalog): getSellers, getCollections, getCollectionBySlug — 4 TDD tests

Completes CatalogService. All 13 catalog service unit tests per spec."
```

---

## Task 7: `catalog.router.ts` — 5 routes

**Files:**
- Rewrite: `src/modules/catalog/catalog.router.ts`

- [ ] **Step 1: Replace stub with full router**

Replace `src/modules/catalog/catalog.router.ts`:
```ts
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { CatalogService } from './catalog.service';
import {
  productsQuerySchema,
  paginatedListingsSchema,
  slugParamSchema,
  currencyQuerySchema,
  productDetailSchema,
  sellersResponseSchema,
  collectionsResponseSchema,
  collectionDetailSchema,
} from './catalog.schema';

export function buildCatalogRouter(
  catalogService: CatalogService,
): FastifyPluginAsync {
  const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.get(
      '/products',
      {
        schema: {
          tags: ['catalog'],
          querystring: productsQuerySchema,
          response: { 200: paginatedListingsSchema },
        },
      },
      async (request) => {
        return catalogService.getListings(request.query);
      },
    );

    typed.get(
      '/products/:slug',
      {
        schema: {
          tags: ['catalog'],
          params: slugParamSchema,
          querystring: currencyQuerySchema,
          response: { 200: productDetailSchema },
        },
      },
      async (request) => {
        return catalogService.getProductBySlug(
          request.params.slug,
          request.query.currency,
        );
      },
    );

    typed.get(
      '/sellers',
      {
        schema: {
          tags: ['catalog'],
          response: { 200: sellersResponseSchema },
        },
      },
      async () => {
        const data = await catalogService.getSellers();
        return { data };
      },
    );

    typed.get(
      '/collections',
      {
        schema: {
          tags: ['catalog'],
          response: { 200: collectionsResponseSchema },
        },
      },
      async () => {
        const data = await catalogService.getCollections();
        return { data };
      },
    );

    typed.get(
      '/collections/:slug',
      {
        schema: {
          tags: ['catalog'],
          params: slugParamSchema,
          querystring: currencyQuerySchema,
          response: { 200: collectionDetailSchema },
        },
      },
      async (request) => {
        return catalogService.getCollectionBySlug(
          request.params.slug,
          request.query.currency,
        );
      },
    );
  };

  return plugin;
}
```

- [ ] **Step 2: Typecheck + tests**

```bash
pnpm typecheck
pnpm test
```
Expected: typecheck clean, 45 tests still pass.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/modules/catalog/catalog.router.ts
git commit -m "feat(backend/catalog): router with 5 endpoints + Zod type provider"
```

---

## Task 8: Wire catalog into `app.ts`

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Update `app.ts`**

Changes needed:
1. Import `FxService` and `buildCatalogRouter` and `CatalogService`
2. Remove old `catalogRouter` stub import
3. Create `FxService` instance with env config
4. Create `CatalogService` instance
5. Replace `catalogRouter` registration with `buildCatalogRouter(catalogService)`

Add imports:
```ts
import { FxService } from './shared/currency/fx.service';
import { CatalogService } from './modules/catalog/catalog.service';
import { buildCatalogRouter } from './modules/catalog/catalog.router';
```

Remove:
```ts
import { catalogRouter } from './modules/catalog/catalog.router';
```

After `authService` creation, add:
```ts
const fxService = new FxService(db, redis, {
  apiKey: env.FX_API_KEY,
  baseCurrency: env.FX_BASE_CURRENCY,
  cacheTtlSeconds: env.FX_CACHE_TTL_SECONDS,
});

const catalogService = new CatalogService(db, fxService);
```

In the route registration, replace `await api.register(catalogRouter)` with:
```ts
await api.register(buildCatalogRouter(catalogService));
```

- [ ] **Step 2: Typecheck + tests**

```bash
pnpm typecheck
pnpm test
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/app.ts
git commit -m "feat(backend): wire FxService and CatalogService into app.ts"
```

---

## Task 9: Smoke test

**Files:** none — verification only.

**Prerequisites:** Docker running, migration applied, `.env` with `FX_API_KEY`.

- [ ] **Step 1: Seed some test data**

Since no seed script exists yet, insert test data directly via psql:

```bash
docker exec flowers-postgres psql -U flowers -d flowers_db -c "
INSERT INTO sellers (id, name, country, rating, verified) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Flores de Colombia', 'CO', 4, true),
  ('a0000000-0000-0000-0000-000000000002', 'Ecuador Roses', 'EC', 5, true);

INSERT INTO categories (id, name, slug) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'Roses', 'roses'),
  ('b0000000-0000-0000-0000-000000000002', 'Tulips', 'tulips');

INSERT INTO products (id, name, slug, species, color, image_url, category_id) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'Pink Mondial', 'pink-mondial', 'Rose', 'Pink', 'https://example.com/pink.jpg', 'b0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000002', 'Red Freedom', 'red-freedom', 'Rose', 'Red', 'https://example.com/red.jpg', 'b0000000-0000-0000-0000-000000000001');

INSERT INTO listings (id, product_id, seller_id, seller_price_usd, ams_price_usd, box_quantity, available_stock, delivery_date) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 12.50, 14.00, 25, 100, '2026-04-20'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 11.80, 14.00, 25, 50, '2026-04-18'),
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 10.00, 12.00, 20, 200, '2026-04-22');

INSERT INTO collections (id, name, slug, type, sort_order) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'Spring Collection', 'spring-collection', 'seasonal', 1);

INSERT INTO collection_items (collection_id, listing_id, sort_order) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 1),
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 2);
"
```

- [ ] **Step 2: Start the dev server**

```bash
pnpm dev &
sleep 3
curl -s http://localhost:3000/health
```

- [ ] **Step 3: GET /products (no filters)**

```bash
curl -s http://localhost:3000/api/v1/products | head -80
```
Expected: JSON with `data` array (3 listings) and `meta` with `total: 3`.

- [ ] **Step 4: GET /products?category=roses**

```bash
curl -s 'http://localhost:3000/api/v1/products?category=roses'
```
Expected: 2 listings (both rose products).

- [ ] **Step 5: GET /products?currency=EUR**

```bash
curl -s 'http://localhost:3000/api/v1/products?currency=EUR'
```
Expected: prices converted to EUR (not USD). If `FX_API_KEY` is invalid, prices will be in USD (fallback rate 1.0).

- [ ] **Step 6: GET /products/pink-mondial**

```bash
curl -s http://localhost:3000/api/v1/products/pink-mondial
```
Expected: product detail with 2 listings (from 2 sellers).

- [ ] **Step 7: GET /products/nonexistent**

```bash
curl -s http://localhost:3000/api/v1/products/nonexistent
```
Expected: 404 NOT_FOUND.

- [ ] **Step 8: GET /sellers**

```bash
curl -s http://localhost:3000/api/v1/sellers
```
Expected: 2 sellers.

- [ ] **Step 9: GET /collections**

```bash
curl -s http://localhost:3000/api/v1/collections
```
Expected: 1 collection (Spring Collection).

- [ ] **Step 10: GET /collections/spring-collection**

```bash
curl -s http://localhost:3000/api/v1/collections/spring-collection
```
Expected: collection with 2 items.

- [ ] **Step 11: Stop dev server, run full test suite**

```bash
kill %1 2>/dev/null || true
pnpm test
pnpm typecheck
```
Expected: 45+ tests pass, typecheck clean.

---

## Out of scope

These are intentionally NOT in this plan:

- Full-text search by product name
- Seller detail page (`GET /sellers/:id`)
- Collection CRUD
- Product image upload
- Price history or analytics
- Listing creation/update (admin endpoints)
- Rate limiting on FX API calls
- FX rate pre-warming on app startup
