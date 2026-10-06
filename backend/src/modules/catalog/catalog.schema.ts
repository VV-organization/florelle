import { z } from 'zod';

export const currencySchema = z.enum(['KZT', 'TRY', 'RUB']).default('RUB');
export const pricingCurrencySchema = z.enum(['USD', 'KZT', 'TRY', 'RUB']);

export const segmentSchema = z.enum(['b2b', 'b2c']).default('b2b');
export type Segment = z.infer<typeof segmentSchema>;

// Optional sibling that does NOT default to USD — used when a query parameter
// must be distinguishable from "absent" (e.g. price_currency, where presence
// signals "the min/max number is in this currency, not in `currency`").
export const optionalCurrencySchema = pricingCurrencySchema.optional();

export const langSchema = z.enum(['en', 'ru']).default('ru');

export const productsQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    categories: z.string().optional(),
    colors: z.string().optional(),
    category: z.string().optional(),
    collection: z.string().optional(),
    seller: z.string().uuid().optional(),
    color: z.string().optional(),
    min_price: z.coerce.number().nonnegative().optional(),
    max_price: z.coerce.number().nonnegative().optional(),
    // Currency the min_price/max_price values are expressed in. Allows the
    // frontend to keep the price filter in a canonical currency (USD) so it
    // survives display-currency switches without changing meaning. When
    // omitted, falls back to `currency` (the legacy behaviour).
    price_currency: optionalCurrencySchema,
    delivery_date: z.string().date().optional(),
    sort: z
      .enum(['price_asc', 'price_desc', 'delivery_asc', 'delivery', 'newest', 'featured', 'name'])
      .default('newest'),
    currency: currencySchema,
    lang: langSchema,
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).optional(),
    page_size: z.coerce.number().int().positive().max(100).optional(),
    segment: segmentSchema,
  })
  .transform((v) => ({
    ...v,
    // Frontend sends page_size, backend uses limit internally
    limit: v.limit ?? v.page_size ?? 24,
    // Normalize sort value
    sort: v.sort === 'delivery' ? ('delivery_asc' as const) : v.sort,
  }));

export const slugParamSchema = z.object({
  slug: z.string().min(1),
});

export const currencyQuerySchema = z.object({
  currency: currencySchema,
  lang: langSchema,
  segment: segmentSchema,
});

const categoryRefSchema = z
  .object({ name: z.string(), slug: z.string() })
  .nullable();

export const photoSchema=z.object({url:z.string().optional(),variants:z.array(z.object({src:z.string(),width:z.number(),height:z.number()})),framing:z.object({bottom:z.number(),width:z.number(),height:z.number()}).optional()});

const sellerRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  logo_url: z.string(),
  country: z.string(),
  verified: z.boolean(),
});

const productRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  image_url: z.string(),
  category_id: z.string().uuid().nullable(),
});

export const listingItemSchema = z.object({
  id: z.string().uuid(),
  product: productRefSchema,
  image:z.string().optional(),
  photo:photoSchema.optional(),
  category:z.object({name:z.string(),name_en:z.string(),slug:z.string()}).nullable().optional(),
  color:z.string().optional(),
  stem_length_cm:z.number().nullable().optional(),
  head_size:z.string().nullable().optional(),
  description_en:z.string().nullable().optional(),
  wholesale:z.object({seller_price:z.string(),ams_price:z.string().nullable(),available_units:z.number()}).optional(),
  seller: sellerRefSchema,
  seller_price: z.string(),
  ams_price: z.string().nullable(),
  box_quantity: z.number().int(),
  available_units: z.number().int(),
  unit: z.enum(['box', 'stem']),
  delivery_date: z.string(),
  currency: currencySchema,
});

export const paginationMetaSchema = z.object({
  total: z.number().int(),
  page: z.number().int(),
  page_size: z.number().int(),
  has_next: z.boolean(),
});

export const categoryFacetSchema = z.object({
  name_en:z.string().optional(),
  slug: z.string(),
  name: z.string(),
  count: z.number().int(),
});

export const paginatedListingsSchema = z.object({
  items: z.array(listingItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  page_size: z.number().int(),
  has_next: z.boolean(),
  facets: z.object({
    categories: z.array(categoryFacetSchema),
  }),
});

export const productDetailListingSchema = z.object({
  id: z.string().uuid(),
  seller: sellerRefSchema,
  seller_price: z.string(),
  ams_price: z.string().nullable(),
  box_quantity: z.number().int(),
  available_units: z.number().int(),
  unit: z.enum(['box', 'stem']),
  delivery_date: z.string(),
  currency: currencySchema,
});

export const productDetailSchema = z.object({
  image:z.string().optional(),
  photo:photoSchema.optional(),
  description_en:z.string().nullable().optional(),
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  image_url: z.string(),
  category_id: z.string().uuid().nullable(),
  species: z.string(),
  color: z.string(),
  stem_length_cm: z.number().int().nullable(),
  head_size: z.string().nullable(),
  category: categoryRefSchema,
  listings: z.array(productDetailListingSchema),
});

export const sellerSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  logo_url: z.string().nullable(),
  country: z.string(),
  rating: z.number().int(),
  verified: z.boolean(),
});

export const sellersResponseSchema = z.object({
  data: z.array(sellerSchema),
});

export const collectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  image_url: z.string().nullable(),
  icon: z.string().nullable(),
  product_count: z.number().int(),
});

export const collectionsResponseSchema = z.object({
  data: z.array(collectionSchema),
});

export const collectionDetailSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  type: z.enum(['promo', 'seasonal', 'editorial']),
  image_url: z.string().nullable(),
  items: z.array(
    listingItemSchema.extend({ sort_order: z.number().int() }),
  ),
});

export const categoryListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  product_count: z.number().int(),
});

export type CategoryListItem = z.infer<typeof categoryListItemSchema>;

export type ProductsQuery = z.output<typeof productsQuerySchema>;
export type ListingItem = z.infer<typeof listingItemSchema>;
export type ProductDetail = z.infer<typeof productDetailSchema>;
export type Seller = z.infer<typeof sellerSchema>;
export type Collection = z.infer<typeof collectionSchema>;
export type CollectionDetail = z.infer<typeof collectionDetailSchema>;
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;
export type CategoryFacet = z.infer<typeof categoryFacetSchema>;
