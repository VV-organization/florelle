import { mediaAssets } from '../../shared/db/schema/storefront';
import { nativePriceWrite } from '../catalog/native-pricing';
import { exchangeRates } from '../../shared/db/schema/exchange-rates';
import { env } from '../../shared/env';
import { offerWriteContract, productWriteContract } from './catalog-write-contract';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import type { Database } from '../../shared/db/client';
import {
  cartItems,
  catalogProtocolOperations,
  categories,
  collectionItems,
  listings,
  orderItems,
  orders,
  payments,
  products,
  sellers,
  type CatalogProtocolOperation,
} from '../../shared/db/schema';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/middleware/error.middleware';
import type { CatalogProtocolActor } from './catalog-protocol.auth';
import {
  categoryCreateSchema,
  categoryUpdateSchema,
  offerCreateSchema,
  offerUpdateSchema,
  productCreateSchema,
  productUpdateSchema,
  sellerCreateSchema,
  sellerUpdateSchema,
} from './catalog-protocol.schema';

type ProtocolRequest = {
  actor: CatalogProtocolActor;
  ifMatch: string | undefined;
  method: string;
  path: string;
  rawBody: Buffer;
};
type ProtocolResponse = { body: unknown; status: number };
type MutationHandler = (tx: Database) => Promise<ProtocolResponse>;
type ListOptions = {
  limit?: number;
  cursor?: string | null;
};
type ListPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export const flowerPointCatalogCapability = (origin: string) =>
  ({
    baseUrl: `${origin}/api/v1/integration/catalog`,
    auth: { scheme: 'vv_hmac' },
    locales: ['ru', 'en'],
    categories: {
      enabled: true,
      maxDepth: 2,
      fields: ['name', 'slug', 'image', 'sortOrder', 'isActive'],
      deletion: { mode: 'blocked_by_references', dryRun: true },
    },
    resources: {
      products: {
        enabled: true,
        categoryRequired: false,
        schema: flowerProductAttributesSchema,
        write: productWriteContract(flowerProductAttributesSchema),
      },
      offers: {
        enabled: true,
        requiredForPurchasableProduct: true,
        schema: flowerOfferAttributesSchema,
        write: offerWriteContract(flowerOfferAttributesSchema),
        availability: {
          defaultUnit: 'stem',
          units: [{ value: 'stem', label: 'стебель' }],
        },
      },
      destinations: { enabled: false, orderedProductMembership: false },
      sellers: { enabled: true, mode: 'managed', schema: flowerSellerAttributesSchema },
      collections: { enabled: false },
    },
    media: {
      mode: 'url',
      maxBytes: 10 * 1024 * 1024,
      upload:{url:`${origin}/admin/integration/media`,method:'POST',auth:'bearer',body:'raw'},
      mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    },
  });

const flowerProductAttributesSchema = {
  type: 'object',
  properties: {
    species: { type: 'string', title: 'Вид' },
    color: { type: 'string', title: 'Цвет' },
    stemLengthCm: { type: ['integer', 'null'], title: 'Длина стебля, см' },
    headSize: { type: ['string', 'null'], title: 'Размер бутона' },
  },
  required: ['species', 'color'],
} as const;

const flowerOfferAttributesSchema = {
  type: 'object',
  properties: {
    retailPrice: { type: 'string', title: 'Розничная цена RUB' },
    referencePrice: { type: 'string', title: 'AMS цена RUB' },
    amsPriceUsd: { type: 'string', title: 'AMS price USD (legacy)' },
  },
} as const;

const flowerSellerAttributesSchema = {
  type: 'object',
  properties: {
    country: { type: 'string', title: 'Страна' },
    rating: { type: 'integer', title: 'Рейтинг', minimum: 0, maximum: 100 },
    verified: { type: 'boolean', title: 'Проверен' },
  },
  required: ['country'],
} as const;

export class CatalogProtocolService {
  constructor(
    private readonly db: Database,
    private readonly origin = 'https://florelle.local',
  ) {}

  getCapabilities() {
    return flowerPointCatalogCapability(this.origin);
  }

  async listCategories(options: ListOptions = {}) {
    const rows = await this.db.select().from(categories).orderBy(categories.sortOrder);
    return paginate(rows.map(toCategoryResource), options);
  }

  async listProducts(options: ListOptions = {}) {
    const rows = await this.db.select().from(products).orderBy(products.sortOrder);
    return paginate(rows.map(toProductResource), options);
  }

  async listOffers(options: ListOptions = {}) {
    const rows = await this.db.select().from(listings).orderBy(listings.createdAt);
    return paginate(rows.map(toOfferResource), options);
  }

  async listSellers(options: ListOptions = {}) {
    const rows = await this.db.select().from(sellers).orderBy(sellers.createdAt);
    return paginate(rows.map(toSellerResource), options);
  }

  async createSeller(request: ProtocolRequest, body: unknown) {
    return this.runMutation(request, async (tx) => {
      const input = sellerCreateSchema.parse(body);
      const [row] = await tx
        .insert(sellers)
        .values({
          name: input.title,
          slug: input.slug,
          country: input.attributes.country,
          logoUrl: input.image?.url ?? null,
          rating: input.attributes.rating ?? 0,
          verified: input.attributes.verified ?? false,
          isActive: input.isActive,
        })
        .returning();
      if (!row) throw new Error('Seller was not created');
      return created(toSellerResource(row));
    });
  }

  async updateSeller(request: ProtocolRequest, id: string, body: unknown) {
    return this.runMutation(request, async (tx) => {
      const input = sellerUpdateSchema.parse(body);
      const current = await this.getSeller(tx, id);
      assertRevision(current, request);
      const [row] = await tx
        .update(sellers)
        .set({
          ...(input.title ? { name: input.title } : {}),
          ...(input.slug ? { slug: input.slug } : {}),
          ...(input.image !== undefined ? { logoUrl: input.image?.url ?? null } : {}),
          ...(input.attributes?.country !== undefined
            ? { country: input.attributes.country }
            : {}),
          ...(input.attributes?.rating !== undefined
            ? { rating: input.attributes.rating }
            : {}),
          ...(input.attributes?.verified !== undefined
            ? { verified: input.attributes.verified }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          updatedAt: new Date(),
        })
        .where(eq(sellers.id, id))
        .returning();
      if (!row) throw new Error('Seller was not updated');
      return ok(toSellerResource(row));
    });
  }

  async deleteSeller(request: ProtocolRequest, id: string, dryRun: boolean) {
    return this.runMutation(request, async (tx) => {
      const current = await this.getSeller(tx, id);
      assertRevision(current, request);
      const relatedListings = await tx
        .select({ id: listings.id })
        .from(listings)
        .where(eq(listings.sellerId, id));
      const listingIds = relatedListings.map((row) => row.id);
      const relatedOrderIds = await orderIdsForListings(tx, listingIds);
      const preview = {
        id,
        dryRun,
        revision: revision(current),
        permitted: true,
        deletedOrders: relatedOrderIds.length,
        deletedOffers: listingIds.length,
      };
      if (dryRun) return ok(preview);
      await deleteOrders(tx, relatedOrderIds);
      if (listingIds.length > 0) {
        await tx.delete(cartItems).where(inArray(cartItems.listingId, listingIds));
        await tx.delete(collectionItems).where(inArray(collectionItems.listingId, listingIds));
        await tx.delete(listings).where(inArray(listings.id, listingIds));
      }
      await tx.delete(sellers).where(eq(sellers.id, id));
      return ok(preview);
    });
  }

  async createCategory(request: ProtocolRequest, body: unknown) {
    return this.runMutation(request, async (tx) => {
      const input = categoryCreateSchema.parse(body);
      await this.ensureCategoryParent(tx, input.parentId);
      const [row] = await tx
        .insert(categories)
        .values({
          parentId: input.parentId,
          name: input.name,
          slug: input.slug,
          imageUrl: input.image?.url ?? null,
          sortOrder: input.sortOrder,
          isActive: input.isActive,
        })
        .returning();
      if (!row) throw new Error('Category was not created');
      return created(toCategoryResource(row));
    });
  }

  async updateCategory(request: ProtocolRequest, id: string, body: unknown) {
    return this.runMutation(request, async (tx) => {
      const input = categoryUpdateSchema.parse(body);
      const current = await this.getCategory(tx, id);
      assertRevision(current, request);
      await this.ensureCategoryParent(tx, input.parentId);
      const [row] = await tx
        .update(categories)
        .set({
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
          ...(input.name ? { name: input.name } : {}),
          ...(input.slug ? { slug: input.slug } : {}),
          ...(input.image !== undefined ? { imageUrl: input.image?.url ?? null } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          updatedAt: new Date(),
        })
        .where(eq(categories.id, id))
        .returning();
      if (!row) throw new Error('Category was not updated');
      return ok(toCategoryResource(row));
    });
  }

  async deleteCategory(request: ProtocolRequest, id: string, dryRun: boolean) {
    return this.runMutation(request, async (tx) => {
      const current = await this.getCategory(tx, id);
      assertRevision(current, request);
      const blocking = await categoryBlockingReferences(tx, id);
      const preview = {
        id,
        dryRun,
        revision: revision(current),
        permitted: blocking.products === 0 && blocking.children === 0,
        blockingReferences: blocking,
      };
      if (dryRun) return ok(preview);
      if (!preview.permitted) throw new ConflictError('Category has related data');
      await tx.delete(categories).where(eq(categories.id, id));
      return ok(preview);
    });
  }

  async createProduct(request: ProtocolRequest, body: unknown) {
    return this.runMutation(request, async (tx) => {
      const input = productCreateSchema.parse(body);
      await this.ensureCategory(tx, input.categoryId);
      const [row] = await tx
        .insert(products)
        .values({
          categoryId: input.categoryId,
          name: input.title,
          slug: input.slug,
          description: input.description,
          imageUrl: input.media[0]?.url ?? '',
          photo: input.media[0]?await this.photoForUrl(tx,input.media[0].url):null,
          species: stringAttribute(input.attributes, 'species'),
          color: stringAttribute(input.attributes, 'color'),
          stemLengthCm: numberAttribute(input.attributes, 'stemLengthCm'),
          headSize: nullableStringAttribute(input.attributes, 'headSize'),
          sortOrder: input.sortOrder,
          isActive: input.isActive,
        })
        .returning();
      if (!row) throw new Error('Product was not created');
      return created(toProductResource(row));
    });
  }

  async updateProduct(request: ProtocolRequest, id: string, body: unknown) {
    return this.runMutation(request, async (tx) => {
      const input = productUpdateSchema.parse(body);
      const current = await this.getProduct(tx, id);
      assertRevision(current, request);
      await this.ensureCategory(tx, input.categoryId);
      const [row] = await tx
        .update(products)
        .set({
          ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
          ...(input.title ? { name: input.title } : {}),
          ...(input.slug ? { slug: input.slug } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.media ? { imageUrl: input.media[0]?.url ?? '', photo:input.media[0]?.url===current.imageUrl?current.photo:input.media[0]?await this.photoForUrl(tx,input.media[0].url):null } : {}),
          ...(input.attributes?.species !== undefined
            ? { species: stringAttribute(input.attributes, 'species') }
            : {}),
          ...(input.attributes?.color !== undefined
            ? { color: stringAttribute(input.attributes, 'color') }
            : {}),
          ...(input.attributes?.stemLengthCm !== undefined
            ? { stemLengthCm: numberAttribute(input.attributes, 'stemLengthCm') }
            : {}),
          ...(input.attributes?.headSize !== undefined
            ? { headSize: nullableStringAttribute(input.attributes, 'headSize') }
            : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          updatedAt: new Date(),
        })
        .where(eq(products.id, id))
        .returning();
      if (!row) throw new Error('Product was not updated');
      return ok(toProductResource(row));
    });
  }

  async deleteProduct(request: ProtocolRequest, id: string, dryRun: boolean) {
    return this.runMutation(request, async (tx) => {
      const current = await this.getProduct(tx, id);
      assertRevision(current, request);
      const relatedListings = await tx
        .select({ id: listings.id })
        .from(listings)
        .where(eq(listings.productId, id));
      const listingIds = relatedListings.map((row) => row.id);
      const relatedOrderIds = await orderIdsForListings(tx, listingIds);
      const preview = {
        id,
        dryRun,
        revision: revision(current),
        permitted: true,
        deletedOrders: relatedOrderIds.length,
        deletedOffers: listingIds.length,
      };
      if (dryRun) return ok(preview);
      await deleteOrders(tx, relatedOrderIds);
      if (listingIds.length > 0) {
        await tx.delete(cartItems).where(inArray(cartItems.listingId, listingIds));
        await tx.delete(collectionItems).where(inArray(collectionItems.listingId, listingIds));
      }
      await tx.delete(products).where(eq(products.id, id));
      return ok(preview);
    });
  }

  async createOffer(request: ProtocolRequest, body: unknown) {
    return this.runMutation(request, async (tx) => {
      const input = offerCreateSchema.parse(body);
      await this.getProduct(tx, input.productId);
      await this.getSeller(tx, input.sellerId);
      const [row] = await tx
        .insert(listings)
        .values({
          productId: input.productId,
          sellerId: input.sellerId,
          ...await this.offerPrices(tx,input,null),
          boxQuantity: input.packageQuantity ?? input.minimumQuantity ?? 1,
          availableStems: input.availability.quantity,
          deliveryDate: input.delivery.value,
          isActive: input.isActive,
        })
        .returning();
      if (!row) throw new Error('Offer was not created');
      return created(toOfferResource(row));
    });
  }

  async updateOffer(request: ProtocolRequest, id: string, body: unknown) {
    return this.runMutation(request, async (tx) => {
      const input = offerUpdateSchema.parse(body);
      const current = await this.getOffer(tx, id);
      assertRevision(current, request);
      if (input.productId) await this.getProduct(tx, input.productId);
      if (input.sellerId) await this.getSeller(tx, input.sellerId);
      const [row] = await tx
        .update(listings)
        .set({
          ...(input.productId ? { productId: input.productId } : {}),
          ...(input.sellerId ? { sellerId: input.sellerId } : {}),
          ...((input.price || input.attributes?.retailPrice!==undefined || input.attributes?.referencePrice!==undefined || input.attributes?.amsPriceUsd!==undefined)?await this.offerPrices(tx,input,current):{}),
          ...(input.packageQuantity !== undefined && input.packageQuantity !== null
            ? { boxQuantity: input.packageQuantity }
            : {}),
          ...(input.availability ? { availableStems: input.availability.quantity } : {}),
          ...(input.delivery ? { deliveryDate: input.delivery.value } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          updatedAt: new Date(),
        })
        .where(eq(listings.id, id))
        .returning();
      if (!row) throw new Error('Offer was not updated');
      return ok(toOfferResource(row));
    });
  }

  async deleteOffer(request: ProtocolRequest, id: string, dryRun: boolean) {
    return this.runMutation(request, async (tx) => {
      const current = await this.getOffer(tx, id);
      assertRevision(current, request);
      const relatedOrderIds = await orderIdsForListings(tx, [id]);
      const preview = {
        id,
        dryRun,
        revision: revision(current),
        permitted: true,
        deletedOrders: relatedOrderIds.length,
      };
      if (dryRun) return ok(preview);
      await deleteOrders(tx, relatedOrderIds);
      await tx.delete(cartItems).where(eq(cartItems.listingId, id));
      await tx.delete(collectionItems).where(eq(collectionItems.listingId, id));
      await tx.delete(listings).where(eq(listings.id, id));
      return ok(preview);
    });
  }

  private async photoForUrl(tx:Database,url:string){
    const filename=url.split('/').at(-1)!;
    const [asset]=await tx.select({metadata:mediaAssets.metadata}).from(mediaAssets).where(eq(mediaAssets.filename,filename)).limit(1);
    return asset?.metadata??{url,variants:[]};
  }
  private async offerPrices(tx:Database,input:Parameters<typeof nativePriceWrite>[0],current:Parameters<typeof nativePriceWrite>[1]){
    const [row]=await tx.select({rate:exchangeRates.rate}).from(exchangeRates).where(and(eq(exchangeRates.base,'USD'),eq(exchangeRates.target,'RUB'))).limit(1);
    return nativePriceWrite(input,current,Number(row?.rate),env.PLATFORM_RETAIL_MARKUP);
  }
  async getOperation(siteKey: string, operationId: string) {
    const [operation] = await this.db
      .select()
      .from(catalogProtocolOperations)
      .where(
        and(
          eq(catalogProtocolOperations.siteKey, siteKey),
          eq(catalogProtocolOperations.id, operationId),
        ),
      )
      .limit(1);
    if (!operation?.responseBody || operation.responseStatus === null) {
      throw new NotFoundError('Operation not found');
    }
    return { body: operation.responseBody, status: operation.responseStatus };
  }

  async getOperationByRequest(siteKey: string, requestId: string) {
    const [operation] = await this.db
      .select()
      .from(catalogProtocolOperations)
      .where(
        and(
          eq(catalogProtocolOperations.siteKey, siteKey),
          eq(catalogProtocolOperations.requestId, requestId),
        ),
      )
      .limit(1);
    if (!operation) throw new NotFoundError('Operation not found');
    if (operation.state === 'in_progress') {
      return { requestId, status: 'in_progress' };
    }
    return {
      requestId,
      status: operation.state,
      response: {
        status: operation.responseStatus,
        body: operation.responseBody,
      },
    };
  }

  private async runMutation(
    request: ProtocolRequest,
    handler: MutationHandler,
  ): Promise<ProtocolResponse> {
    if (!request.actor.idempotencyKey) {
      throw new ValidationError('Mutation idempotency key is required');
    }
    return this.db.transaction(async (tx) => {
      const operation = await beginOperation(tx, request);
      if (operation.state !== 'in_progress') return operation.response;
      try {
        const response = await handler(tx as Database);
        const body = addOperationId(response.body, operation.operation.id);
        await completeOperation(tx, operation.operation, {
          body,
          status: response.status,
        });
        return { body, status: response.status };
      } catch (error) {
        const response = {
          body: toProblem(error, operation.operation.id),
          status: statusFromError(error),
        };
        await completeOperation(tx, operation.operation, response, 'failed');
        return response;
      }
    });
  }

  private async getCategory(tx: Database, id: string) {
    const [row] = await tx.select().from(categories).where(eq(categories.id, id)).limit(1);
    if (!row) throw new NotFoundError('Category not found');
    return row;
  }

  private async getProduct(tx: Database, id: string) {
    const [row] = await tx.select().from(products).where(eq(products.id, id)).limit(1);
    if (!row) throw new NotFoundError('Product not found');
    return row;
  }

  private async getOffer(tx: Database, id: string) {
    const [row] = await tx.select().from(listings).where(eq(listings.id, id)).limit(1);
    if (!row) throw new NotFoundError('Offer not found');
    return row;
  }

  private async getSeller(tx: Database, id: string) {
    const [row] = await tx.select().from(sellers).where(eq(sellers.id, id)).limit(1);
    if (!row) throw new NotFoundError('Seller not found');
    return row;
  }

  private async ensureCategory(tx: Database, id: string | null | undefined) {
    if (id == null) return;
    await this.getCategory(tx, id);
  }

  private async ensureCategoryParent(tx: Database, id: string | null | undefined) {
    if (id == null) return;
    await this.getCategory(tx, id);
  }
}

function ok(resource: unknown): ProtocolResponse {
  return { body: { resource }, status: 200 };
}

function created(resource: unknown): ProtocolResponse {
  return { body: { resource }, status: 201 };
}

function paginate<T>(items: T[], options: ListOptions): ListPage<T> {
  const limit = normalizeLimit(options.limit);
  const offset = normalizeCursor(options.cursor);
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    items: page,
    nextCursor: nextOffset < items.length ? String(nextOffset) : null,
  };
}

function normalizeLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 100;
  return Math.min(Math.max(value, 1), 100);
}

function normalizeCursor(value: string | null | undefined): number {
  if (!value) return 0;
  if (!/^\d+$/.test(value)) throw new ValidationError('Invalid catalog cursor');
  return Number(value);
}

async function beginOperation(tx: Database, request: ProtocolRequest) {
  const fingerprint = requestFingerprint(request);
  const values = {
    id: randomUUID(),
    actorId: request.actor.actorId,
    idempotencyKey: request.actor.idempotencyKey!,
    method: request.method.toUpperCase(),
    path: request.path,
    requestFingerprint: fingerprint,
    requestId: request.actor.requestId,
    siteKey: request.actor.siteKey,
    state: 'in_progress' as const,
  };
  const [inserted] = await tx
    .insert(catalogProtocolOperations)
    .values(values)
    .onConflictDoNothing()
    .returning();
  const [operation] = inserted
    ? [inserted]
    : await tx
        .select()
        .from(catalogProtocolOperations)
        .where(
          and(
            eq(catalogProtocolOperations.siteKey, request.actor.siteKey),
            eq(catalogProtocolOperations.idempotencyKey, request.actor.idempotencyKey!),
          ),
        )
        .limit(1);
  if (!operation) throw new ConflictError('Protocol operation conflict');
  if (operation.requestFingerprint !== fingerprint) {
    throw new ConflictError('Protocol idempotency key conflicts with a different request');
  }
  if (operation.state === 'in_progress') {
    return { operation, state: 'in_progress' as const };
  }
  return {
    operation,
    response: {
      body: operation.responseBody,
      status: operation.responseStatus ?? 500,
    },
    state: operation.state,
  };
}

async function completeOperation(
  tx: Database,
  operation: CatalogProtocolOperation,
  response: ProtocolResponse,
  state: 'completed' | 'failed' = 'completed',
) {
  await tx
    .update(catalogProtocolOperations)
    .set({
      state,
      responseBody: response.body,
      responseStatus: response.status,
      completedAt: new Date(),
    })
    .where(eq(catalogProtocolOperations.id, operation.id));
}

function requestFingerprint(request: ProtocolRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        method: request.method.toUpperCase(),
        path: request.path,
        body: request.rawBody.toString('base64'),
      }),
    )
    .digest('hex');
}

function addOperationId(body: unknown, operationId: string): unknown {
  return body && typeof body === 'object'
    ? { operationId, ...(body as Record<string, unknown>) }
    : { operationId, resource: body };
}

function toCategoryResource(row: typeof categories.$inferSelect) {
  return {
    id: row.id,
    revision: revision(row),
    parentId: row.parentId ?? null,
    name: row.name.ru,
    slug: row.slug,
    image: media(row.imageUrl, row.name.ru),
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
}

function toProductResource(row: typeof products.$inferSelect) {
  return {
    id: row.id,
    revision: revision(row),
    categoryId: row.categoryId ?? null,
    title: row.name.ru,
    slug: row.slug,
    description: row.description?.ru ?? '',
    media: row.imageUrl ? [media(row.imageUrl, row.name.ru)] : [],
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    attributes: {
      species: row.species,
      color: row.color,
      stemLengthCm: row.stemLengthCm,
      headSize: row.headSize,
    },
  };
}

function toOfferResource(row: typeof listings.$inferSelect) {
  return {
    id: row.id,
    revision: revision(row),
    productId: row.productId,
    sellerId: row.sellerId,
    price: { amountMinor: decimalToMinor(row.wholesalePrice??row.sellerPriceUsd), currency: row.priceCurrency??'USD', scale: 100 },
    availability: { quantity: row.availableStems, unit: 'stem' },
    minimumQuantity: null,
    packageQuantity: row.boxQuantity,
    delivery: { kind: 'date' as const, value: row.deliveryDate },
    isActive: row.isActive,
    attributes: { retailPrice:row.retailPrice,referencePrice:row.referencePrice,amsPriceUsd: row.amsPriceUsd },
  };
}

function toSellerResource(row: typeof sellers.$inferSelect) {
  return {
    id: row.id,
    revision: revision(row),
    title: row.name.ru,
    slug: row.slug,
    image: media(row.logoUrl, row.name.ru),
    isActive: row.isActive,
    attributes: {
      country: row.country,
      rating: row.rating,
      verified: row.verified,
    },
  };
}

function media(url: string | null, alt: string) {
  return url ? { id: url, url, alt: { ru: alt } } : null;
}

function revision(row: { updatedAt?: Date; createdAt: Date }) {
  return String((row.updatedAt ?? row.createdAt).getTime());
}

function assertRevision(row: { updatedAt?: Date; createdAt: Date }, request: ProtocolRequest) {
  const expected = request.ifMatch?.replace(/^"|"$/g, '');
  if (!expected) throw new ValidationError('A current If-Match revision is required');
  if (expected !== revision(row)) throw new ConflictError('Resource revision has changed');
}

function stringAttribute(attributes: Record<string, unknown>, key: string): string {
  const value = attributes[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`Product attribute ${key} is required`);
  }
  return value.trim();
}

function nullableStringAttribute(attributes: Record<string, unknown>, key: string): string | null {
  const value = attributes[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function numberAttribute(attributes: Record<string, unknown>, key: string): number | null {
  const value = attributes[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function decimalToMinor(value: string): number {
  return Math.round(Number(value) * 100);
}



async function categoryBlockingReferences(tx: Database, id: string) {
  const [productCount] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.categoryId, id));
  const [childCount] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(categories)
    .where(eq(categories.parentId, id));
  return {
    products: productCount?.count ?? 0,
    children: childCount?.count ?? 0,
  };
}

async function orderIdsForListings(tx: Database, listingIds: string[]) {
  if (listingIds.length === 0) return [];
  const rows = await tx
    .select({ orderId: orderItems.orderId })
    .from(orderItems)
    .where(inArray(orderItems.listingId, listingIds));
  return [...new Set(rows.map((row) => row.orderId))];
}

async function deleteOrders(tx: Database, orderIds: string[]) {
  if (orderIds.length === 0) return;
  await tx.delete(payments).where(inArray(payments.orderId, orderIds));
  await tx.delete(orders).where(inArray(orders.id, orderIds));
}

function toProblem(error: unknown, operationId: string) {
  const status = statusFromError(error);
  return {
    type: problemType(error, status),
    title: error instanceof Error ? error.message : 'Catalog operation failed',
    status,
    operationId,
  };
}

function statusFromError(error: unknown): number {
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ConflictError) return 409;
  if (
    error instanceof ValidationError &&
    error.message === 'A current If-Match revision is required'
  ) {
    return 428;
  }
  if (error instanceof ValidationError) return 422;
  if (error instanceof ZodError) return 422;
  return 500;
}

function problemType(error: unknown, status: number): string {
  if (status === 428) return 'catalog/precondition-required';
  if (error instanceof ZodError || status === 422) return 'catalog/validation';
  if (status === 404) return 'catalog/not-found';
  if (status === 409) return 'catalog/conflict';
  return 'catalog/internal-error';
}
