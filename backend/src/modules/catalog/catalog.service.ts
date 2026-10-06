import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../shared/db/client';
import type { FxService } from '../../shared/currency/fx.service';
import type {
  ProductsQuery,
  ListingItem,
  ProductDetail,
  CollectionDetail,
  Collection,
  Seller,
  CategoryListItem,
  CategoryFacet,
  Segment,
} from './catalog.schema';
import {
  queryListings,
  queryProductBySlug,
  queryCollectionBySlug,
  type ListingRow,
  type ProductListingRow,
} from './catalog.queries';
import { sellers as sellersTable } from '../../shared/db/schema/sellers';
import { collections } from '../../shared/db/schema/collections';
import { collectionItems } from '../../shared/db/schema/collections';
import { listings } from '../../shared/db/schema/listings';
import { categories, products } from '../../shared/db/schema/products';
import { NotFoundError } from '../../shared/middleware/error.middleware';
import { resolveField } from '../../shared/i18n/resolve-locale';
import type { Locale } from '../../shared/db/schema/types';

function sellerLogo(logoUrl: string | null, name: string): string {
  if (logoUrl) return logoUrl;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  const safe=initials.replace(/[<>&"']/g,'');
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" fill="#1a1a1a"/><text x="64" y="76" text-anchor="middle" fill="#c9a96e" font-family="sans-serif" font-size="40">${safe}</text></svg>`)}`;
}

export class CatalogService {
  constructor(
    private readonly db: Database,
    private readonly fxService: FxService,
  ) {}

  async getListings(
    query: ProductsQuery,
  ): Promise<{
    items: ListingItem[];
    total: number;
    page: number;
    page_size: number;
    has_next: boolean;
    facets: { categories: CategoryFacet[] };
  }> {
    const rate = await this.fxService.getRate(query.currency);

    // Price filters live in their own currency space — by default that's the
    // display currency, but the frontend can pin it to USD (or anything else)
    // via `price_currency` so the filter survives display-currency switches.
    const priceFilterCurrency = query.price_currency ?? query.currency;
    const priceFilterRate =
      priceFilterCurrency === query.currency
        ? rate
        : priceFilterCurrency === 'USD'
          ? 1
          : await this.fxService.getRate(priceFilterCurrency);

    // For B2C, price filter bounds are expressed as retail prices, so we must
    // divide by the markup to compare against wholesale USD in the database.
    const markup = query.segment === 'b2c' ? this.fxService.markup : 1;

    const rubRate=await this.fxService.getRate('RUB');
    const filters = {
      q:query.q,
      segment:query.segment,
      rubRate,markup:this.fxService.markup,
      minPriceRub:query.min_price===undefined?undefined:query.min_price/priceFilterRate*rubRate,
      maxPriceRub:query.max_price===undefined?undefined:query.max_price/priceFilterRate*rubRate,
      categorySlug: query.categories??query.category,
      collectionSlug: query.collection,
      sellerId: query.seller,
      color: query.colors??query.color,
      minPriceUsd:
        query.min_price !== undefined
          ? (query.min_price / priceFilterRate) / markup
          : undefined,
      maxPriceUsd:
        query.max_price !== undefined
          ? (query.max_price / priceFilterRate) / markup
          : undefined,
      deliveryDate: query.delivery_date,
    };

    const { rows, total, facets: facetRows } = await queryListings(
      this.db,
      filters,
      query.sort,
      query.page,
      query.limit,
    );

    const items = await Promise.all(
      rows.map((row) =>
        this.mapListingRow(row, query.currency, query.lang as Locale, query.segment),
      ),
    );

    const pages = Math.ceil(total / query.limit);
    const locale = query.lang as Locale;
    const categoryFacets: CategoryFacet[] = facetRows
      .map((f) => ({
        slug: f.categorySlug,
        name: resolveField(f.categoryName, locale)!,
        count: f.count,
      }))
      .filter((f) => f.count > 0);

    return {
      items,
      total,
      page: query.page,
      page_size: query.limit,
      has_next: query.page < pages,
      facets: { categories: categoryFacets },
    };
  }

  async getListingById(id:string,currency:string,lang:string,segment:Segment='b2b'):Promise<ListingItem>{
    const {rows}=await queryListings(this.db,{listingId:id},'featured',1,1);
    if(!rows[0])throw new NotFoundError('Listing not found');
    return this.mapListingRow(rows[0],currency,lang as Locale,segment);
  }
  private async computeWholesale(row:ListingRow,currency:string){
    const value=await this.computeSegmentFields(row.sellerPriceUsd,row.amsPriceUsd,row.availableStems,row.boxQuantity,currency,'b2b',row);
    return {seller_price:value.sellerPrice,ams_price:value.amsPrice,available_units:value.availableUnits};
  }
  async getProductBySlug(
    slug: string,
    currency: string,
    lang: string,
    segment: Segment = 'b2b',
  ): Promise<ProductDetail> {
    const locale = lang as Locale;
    const { product, listings: productListings } = await queryProductBySlug(
      this.db,
      slug,
    );
    if (!product) throw new NotFoundError('Product not found');

    const convertedListings = await Promise.all(
      productListings.map((l) =>
        this.mapProductDetailListing(l, currency, locale, segment),
      ),
    );

    return {
      id: product.id,
      name: resolveField(product.name, locale)!,
      slug: product.slug,
      description: resolveField(product.description, locale),
      image_url: product.imageUrl,
      image:product.imageUrl,
      photo:product.photo??undefined,
      description_en:product.description?.en??null,
      category_id: product.categoryId ?? null,
      species: product.species,
      color: product.color,
      stem_length_cm: product.stemLengthCm,
      head_size: product.headSize,
      category: product.categoryName
        ? { name: resolveField(product.categoryName, locale)!, slug: product.categorySlug! }
        : null,
      listings: convertedListings,
    };
  }

  async getSellers(lang: string): Promise<Seller[]> {
    const locale = lang as Locale;
    const rows = await this.db
      .select()
      .from(sellersTable)
      .where(eq(sellersTable.isActive, true))
      .orderBy(asc(sellersTable.name));

    return rows.map((r) => ({
      id: r.id,
      name: resolveField(r.name, locale)!,
      slug: r.slug,
      logo_url: sellerLogo(r.logoUrl, r.name.en),
      country: r.country,
      rating: r.rating,
      verified: r.verified,
    }));
  }

  async getCollections(lang: string): Promise<Collection[]> {
    const locale = lang as Locale;
    const rows = await this.db
      .select({
        id: collections.id,
        name: collections.name,
        slug: collections.slug,
        imageUrl: collections.imageUrl,
      })
      .from(collections)
      .where(eq(collections.isActive, true))
      .orderBy(asc(collections.sortOrder));

    // Count listings per collection
    const counts = await this.db
      .select({
        collectionId: collectionItems.collectionId,
        count: sql<number>`count(*)::int`,
      })
      .from(collectionItems)
      .innerJoin(listings, eq(collectionItems.listingId, listings.id))
      .where(eq(listings.isActive, true))
      .groupBy(collectionItems.collectionId);

    const countMap = new Map(counts.map((c) => [c.collectionId, c.count]));

    return rows.map((r) => ({
      id: r.id,
      name: resolveField(r.name, locale)!,
      slug: r.slug,
      image_url: r.imageUrl,
      icon: null,
      product_count: countMap.get(r.id) ?? 0,
    }));
  }

  async getCategories(lang: string): Promise<CategoryListItem[]> {
    const locale = lang as Locale;

    const rows = await this.db
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
      })
      .from(categories)
      .orderBy(asc(categories.slug));

    const counts = await this.db
      .select({
        categoryId: products.categoryId,
        count: sql<number>`count(*)::int`,
      })
      .from(listings)
      .innerJoin(products, eq(listings.productId, products.id))
      .where(and(eq(listings.isActive, true), eq(products.isActive, true)))
      .groupBy(products.categoryId);

    const countMap = new Map(counts.map((c) => [c.categoryId, c.count]));

    return rows
      .map((r) => ({
        id: r.id,
        name: resolveField(r.name, locale)!,
        slug: r.slug,
        product_count: countMap.get(r.id) ?? 0,
      }))
      .filter((c) => c.product_count > 0);
  }

  async getCollectionBySlug(
    slug: string,
    currency: string,
    lang: string,
    segment: Segment = 'b2b',
  ): Promise<CollectionDetail> {
    const locale = lang as Locale;
    const { collection, items } = await queryCollectionBySlug(this.db, slug);
    if (!collection) throw new NotFoundError('Collection not found');

    const convertedItems = await Promise.all(
      items.map(async (item) => ({
        ...(await this.mapListingRow(item, currency, locale, segment)),
        sort_order: item.sortOrder,
      })),
    );

    return {
      id: collection.id,
      name: resolveField(collection.name, locale)!,
      slug: collection.slug,
      type: collection.type,
      image_url: collection.imageUrl,
      items: convertedItems,
    };
  }

  /**
   * Computes the segment-dependent pricing and unit fields shared by both
   * listing mappers. Centralises the branching so future segmentation changes
   * only need to be made in one place.
   */
  private async computeSegmentFields(
    sellerPriceUsd: string,
    amsPriceUsd: string,
    availableStems: number,
    boxQuantity: number,
    currency: string,
    segment: Segment,
    native?:{priceCurrency?:string|null;retailPrice?:string|null;wholesalePrice?:string|null;referencePrice?:string|null},
  ): Promise<{
    sellerPrice: string;
    amsPrice: string | null;
    availableUnits: number;
    unit: 'box' | 'stem';
  }> {
    if(native?.priceCurrency==='RUB'&&native.wholesalePrice&&native.retailPrice){
      const convert=async(value:string)=>currency==='RUB'?Number(value).toFixed(2):(Number(value)/(await this.fxService.getRate('RUB'))*(await this.fxService.getRate(currency))).toFixed(2);
      return {sellerPrice:await convert(segment==='b2c'?native.retailPrice:native.wholesalePrice),amsPrice:segment==='b2c'||!native.referencePrice?null:await convert(native.referencePrice),availableUnits:segment==='b2b'?Math.floor(availableStems/boxQuantity):availableStems,unit:segment==='b2b'?'box':'stem'};
    }
    const sellerPrice =
      segment === 'b2c'
        ? await this.fxService.convertRetail(sellerPriceUsd, currency)
        : await this.fxService.convert(sellerPriceUsd, currency);

    const amsPrice =
      segment === 'b2c'
        ? null
        : await this.fxService.convert(amsPriceUsd, currency);

    const availableUnits =
      segment === 'b2b' ? Math.floor(availableStems / boxQuantity) : availableStems;

    const unit: 'box' | 'stem' = segment === 'b2b' ? 'box' : 'stem';

    return { sellerPrice, amsPrice, availableUnits, unit };
  }

  /**
   * Maps a full listing row (from queryListings / queryCollectionBySlug) to
   * the ListingItem response shape, branching on segment for pricing and unit.
   */
  private async mapListingRow(
    row: ListingRow,
    currency: string,
    locale: Locale,
    segment: Segment,
  ): Promise<ListingItem> {
    const { sellerPrice, amsPrice, availableUnits, unit } =
      await this.computeSegmentFields(
        row.sellerPriceUsd,
        row.amsPriceUsd,
        row.availableStems,
        row.boxQuantity,
        currency,
        segment,
        row,
      );

    return {
      id: row.listingId,
      image:row.productImageUrl,
      photo:row.productPhoto??undefined,
      category:row.categoryName?{name:resolveField(row.categoryName,locale)!,name_en:row.categoryName.en,slug:row.categorySlug!}:null,
      color:row.productColor,
      stem_length_cm:row.stemLengthCm??null,
      head_size:row.headSize??null,
      description_en:row.productDescription?.en??null,
      wholesale:await this.computeWholesale(row,currency),
      product: {
        id: row.productId,
        name: resolveField(row.productName, locale)!,
        slug: row.productSlug,
        description: resolveField(row.productDescription, locale),
        image_url: row.productImageUrl,
        category_id: row.categoryId ?? null,
      },
      seller: {
        id: row.sellerId,
        name: resolveField(row.sellerName, locale)!,
        slug: row.sellerSlug,
        logo_url: sellerLogo(row.sellerLogoUrl ?? null, row.sellerName.en),
        country: row.sellerCountry,
        verified: row.sellerVerified,
      },
      seller_price: sellerPrice,
      ams_price: amsPrice,
      box_quantity: row.boxQuantity,
      available_units: availableUnits,
      unit,
      delivery_date: row.deliveryDate,
      currency: currency as 'KZT' | 'TRY' | 'RUB',
    };
  }

  /**
   * Maps a product-detail listing row (from queryProductBySlug) to the
   * productDetailListing shape, branching on segment for pricing and unit.
   */
  private async mapProductDetailListing(
    l: ProductListingRow,
    currency: string,
    locale: Locale,
    segment: Segment,
  ): Promise<{
    id: string;
    seller: {
      id: string;
      name: string;
      slug: string;
      logo_url: string;
      country: string;
      verified: boolean;
    };
    seller_price: string;
    ams_price: string | null;
    box_quantity: number;
    available_units: number;
    unit: 'box' | 'stem';
    delivery_date: string;
    currency: 'KZT' | 'TRY' | 'RUB';
  }> {
    const { sellerPrice, amsPrice, availableUnits, unit } =
      await this.computeSegmentFields(
        l.sellerPriceUsd,
        l.amsPriceUsd,
        l.availableStems,
        l.boxQuantity,
        currency,
        segment,
        l,
      );

    return {
      id: l.id,
      seller: {
        id: l.sellerId,
        name: resolveField(l.sellerName, locale)!,
        slug: l.sellerSlug,
        logo_url: sellerLogo(l.sellerLogoUrl ?? null, l.sellerName.en),
        country: l.sellerCountry,
        verified: l.sellerVerified,
      },
      seller_price: sellerPrice,
      ams_price: amsPrice,
      box_quantity: l.boxQuantity,
      available_units: availableUnits,
      unit,
      delivery_date: l.deliveryDate,
      currency: currency as 'KZT' | 'TRY' | 'RUB',
    };
  }
}
