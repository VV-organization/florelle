import {
  eq,
  and,
  asc,
  desc,
  lte,
  gte,
  ilike,
  inArray,
  or,
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
  listingId?:string;
  q?:string;
  categorySlug?: string;
  collectionSlug?: string;
  sellerId?: string;
  color?: string;
  minPriceRub?:number;
  maxPriceRub?:number;
  segment?:string;
  rubRate?:number;
  markup?:number;
  minPriceUsd?: number;
  maxPriceUsd?: number;
  deliveryDate?: string;
};

export type SortOption = 'price_asc' | 'price_desc' | 'delivery_asc' | 'newest' | 'featured' | 'name';

export async function queryListings(
  db: Database,
  filters: ListingFilters,
  sort: SortOption,
  page: number,
  limit: number,
): Promise<{ rows: ListingRow[]; total: number; facets: CategoryFacetRow[] }> {
  // Base conditions: everything EXCEPT category (used for facets)
  const baseConditions: SQL[] = [
    eq(listings.isActive, true),
    eq(products.isActive, true),
    eq(sellers.isActive, true),
  ];

  if(filters.listingId)baseConditions.push(eq(listings.id,filters.listingId));
  if(filters.q){const term=`%${filters.q.replace(/[\\%_]/g,c=>'\\'+c)}%`;baseConditions.push(or(sql`${products.name}->>'ru' ILIKE ${term}`,sql`${products.name}->>'en' ILIKE ${term}`,ilike(products.slug,term),sql`${sellers.name}->>'ru' ILIKE ${term}`)!);}
  const nativePrice=filters.segment==='b2c'?listings.retailPrice:listings.wholesalePrice;
  const legacyPrice=sql`${listings.sellerPriceUsd} * ${filters.segment==='b2c'?(filters.markup??1):1} * ${filters.rubRate??1}`;
  const price=sql`coalesce(${nativePrice},${legacyPrice})`;
  if (filters.collectionSlug) {
    baseConditions.push(
      sql`${listings.id} IN (
        SELECT ${collectionItems.listingId}
        FROM ${collectionItems}
        INNER JOIN ${collections} ON ${collectionItems.collectionId} = ${collections.id}
        WHERE ${collections.slug} = ${filters.collectionSlug}
          AND ${collections.isActive} = true
      )`,
    );
  }
  if (filters.sellerId) {
    baseConditions.push(eq(listings.sellerId, filters.sellerId));
  }
  if (filters.color) {
    const color=sql`lower(coalesce(nullif(${products.color},''),${products.slug}))`;
    const colorGroup=sql`CASE WHEN ${color} ~ 'pink|peach|salmon' THEN 'pink' WHEN ${color} ~ 'white|cream' THEN 'white' WHEN ${color} ~ 'yellow' THEN 'yellow' WHEN ${color} ~ 'orange' THEN 'orange' WHEN ${color} ~ 'red|burgundy' THEN 'red' WHEN ${color} ~ 'lilac|purple|lavand' THEN 'purple' WHEN ${color} ~ 'green' THEN 'green' ELSE 'mixed' END`;
    const groups=new Set(['pink','white','yellow','orange','red','purple','green','mixed']);
    baseConditions.push(or(...filters.color.split(',').filter(Boolean).map(c=>groups.has(c)?eq(colorGroup,c):ilike(products.color,c)))!);
  }
  if(filters.minPriceRub!==undefined)baseConditions.push(gte(price,filters.minPriceRub));
  else if (filters.minPriceUsd !== undefined) {
    baseConditions.push(gte(listings.sellerPriceUsd, String(filters.minPriceUsd)));
  }
  if(filters.maxPriceRub!==undefined)baseConditions.push(lte(price,filters.maxPriceRub));
  else if (filters.maxPriceUsd !== undefined) {
    baseConditions.push(lte(listings.sellerPriceUsd, String(filters.maxPriceUsd)));
  }
  if (filters.deliveryDate) {
    baseConditions.push(lte(listings.deliveryDate, filters.deliveryDate));
  }

  // Full conditions: base + category (used for main query + count)
  const allConditions = [...baseConditions];
  if (filters.categorySlug) {
    allConditions.push(inArray(categories.slug, filters.categorySlug.split(',').filter(Boolean)));
  }

  const whereClause = and(...allConditions)!;
  const facetsWhere = and(...baseConditions)!;

  const orderByClause = {
    price_asc: asc(price),
    price_desc: desc(price),
    delivery_asc: asc(listings.deliveryDate),
    newest: desc(listings.createdAt),
    featured:asc(listings.sortOrder),
    name:asc(sql`${products.name}->>'en'`),
  }[sort];

  const baseQuery = db
    .select({
      listingId: listings.id,
      priceCurrency:listings.priceCurrency,
      wholesalePrice:listings.wholesalePrice,
      retailPrice:listings.retailPrice,
      referencePrice:listings.referencePrice,
      sellerPriceUsd: listings.sellerPriceUsd,
      amsPriceUsd: listings.amsPriceUsd,
      boxQuantity: listings.boxQuantity,
      availableStems: listings.availableStems,
      deliveryDate: listings.deliveryDate,
      productId: products.id,
      productName: products.name,
      productSlug: products.slug,
      productSpecies: products.species,
      productColor: products.color,
      productImageUrl: products.imageUrl,
      productPhoto:products.photo,
      stemLengthCm:products.stemLengthCm,
      headSize:products.headSize,
      productDescription: products.description,
      sellerId: sellers.id,
      sellerName: sellers.name,
      sellerSlug: sellers.slug,
      sellerCountry: sellers.country,
      sellerVerified: sellers.verified,
      sellerLogoUrl: sellers.logoUrl,
      categoryId: categories.id,
      categoryName: categories.name,
      categorySlug: categories.slug,
    })
    .from(listings)
    .innerJoin(products, eq(listings.productId, products.id))
    .innerJoin(sellers, eq(listings.sellerId, sellers.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(whereClause)
    .orderBy(orderByClause,asc(listings.sortOrder),asc(listings.id))
    .limit(limit)
    .offset((page - 1) * limit);

  const countQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(listings)
    .innerJoin(products, eq(listings.productId, products.id))
    .innerJoin(sellers, eq(listings.sellerId, sellers.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(whereClause);

  const facetsQuery = db
    .select({
      categoryId: categories.id,
      categoryName: categories.name,
      categorySlug: categories.slug,
      count: sql<number>`count(*)::int`,
    })
    .from(listings)
    .innerJoin(products, eq(listings.productId, products.id))
    .innerJoin(sellers, eq(listings.sellerId, sellers.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(facetsWhere)
    .groupBy(categories.id, categories.name, categories.slug)
    .orderBy(asc(categories.slug));

  const [rows, countResult, facetRows] = await Promise.all([
    baseQuery,
    countQuery,
    facetsQuery,
  ]);
  const total = countResult[0]?.count ?? 0;

  return { rows: rows as ListingRow[], total, facets: facetRows as CategoryFacetRow[] };
}

export type ListingRow = {
  listingId: string;
  priceCurrency?:string|null;
  wholesalePrice?:string|null;
  retailPrice?:string|null;
  referencePrice?:string|null;
  sellerPriceUsd: string;
  amsPriceUsd: string;
  boxQuantity: number;
  availableStems: number;
  deliveryDate: string;
  productId: string;
  productName: { en: string; ru: string };
  productSlug: string;
  productSpecies: string;
  productColor: string;
  productImageUrl: string;
  productPhoto?:import('../../shared/db/schema/storefront').MediaPhoto|null;
  stemLengthCm?:number|null;
  headSize?:string|null;
  productDescription: { en: string; ru: string } | null;
  sellerId: string;
  sellerName: { en: string; ru: string };
  sellerSlug: string;
  sellerCountry: string;
  sellerVerified: boolean;
  sellerLogoUrl: string | null;
  categoryId: string | null;
  categoryName: { en: string; ru: string } | null;
  categorySlug: string | null;
};

export type CategoryFacetRow = {
  categoryId: string;
  categoryName: { en: string; ru: string };
  categorySlug: string;
  count: number;
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
      photo:products.photo,
      description: products.description,
      categoryId: categories.id,
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
      priceCurrency:listings.priceCurrency,
      wholesalePrice:listings.wholesalePrice,
      retailPrice:listings.retailPrice,
      referencePrice:listings.referencePrice,
      sellerPriceUsd: listings.sellerPriceUsd,
      amsPriceUsd: listings.amsPriceUsd,
      boxQuantity: listings.boxQuantity,
      availableStems: listings.availableStems,
      deliveryDate: listings.deliveryDate,
      sellerId: sellers.id,
      sellerName: sellers.name,
      sellerSlug: sellers.slug,
      sellerCountry: sellers.country,
      sellerVerified: sellers.verified,
      sellerLogoUrl: sellers.logoUrl,
    })
    .from(listings)
    .innerJoin(sellers, eq(listings.sellerId, sellers.id))
    .where(
      and(
        eq(listings.productId, product.id),
        eq(listings.isActive, true),
        eq(sellers.isActive, true),
      ),
    )
    .orderBy(asc(listings.sellerPriceUsd));

  return { product: product as ProductRow, listings: listingRows as ProductListingRow[] };
}

export type ProductRow = {
  id: string;
  name: { en: string; ru: string };
  slug: string;
  species: string;
  color: string;
  stemLengthCm: number | null;
  headSize: string | null;
  imageUrl: string;
  photo?:import('../../shared/db/schema/storefront').MediaPhoto|null;
  description: { en: string; ru: string } | null;
  categoryId: string | null;
  categoryName: { en: string; ru: string } | null;
  categorySlug: string | null;
};

export type ProductListingRow = {
  id: string;
  priceCurrency?:string|null;
  wholesalePrice?:string|null;
  retailPrice?:string|null;
  referencePrice?:string|null;
  sellerPriceUsd: string;
  amsPriceUsd: string;
  boxQuantity: number;
  availableStems: number;
  deliveryDate: string;
  sellerId: string;
  sellerName: { en: string; ru: string };
  sellerSlug: string;
  sellerCountry: string;
  sellerVerified: boolean;
  sellerLogoUrl: string | null;
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
      priceCurrency:listings.priceCurrency,
      wholesalePrice:listings.wholesalePrice,
      retailPrice:listings.retailPrice,
      referencePrice:listings.referencePrice,
      sellerPriceUsd: listings.sellerPriceUsd,
      amsPriceUsd: listings.amsPriceUsd,
      boxQuantity: listings.boxQuantity,
      availableStems: listings.availableStems,
      deliveryDate: listings.deliveryDate,
      productId: products.id,
      productName: products.name,
      productSlug: products.slug,
      productSpecies: products.species,
      productColor: products.color,
      productImageUrl: products.imageUrl,
      productPhoto:products.photo,
      stemLengthCm:products.stemLengthCm,
      headSize:products.headSize,
      productDescription: products.description,
      sellerId: sellers.id,
      sellerName: sellers.name,
      sellerSlug: sellers.slug,
      sellerCountry: sellers.country,
      sellerVerified: sellers.verified,
      sellerLogoUrl: sellers.logoUrl,
      categoryId: categories.id,
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
        eq(products.isActive, true),
        eq(listings.isActive, true),
        eq(sellers.isActive, true),
      ),
    )
    .orderBy(asc(collectionItems.sortOrder));

  return { collection: collection as CollectionRow, items: itemRows as CollectionItemRow[] };
}

export type CollectionRow = {
  id: string;
  name: { en: string; ru: string };
  slug: string;
  type: 'promo' | 'seasonal' | 'editorial';
  imageUrl: string | null;
};

export type CollectionItemRow = ListingRow & { sortOrder: number };
