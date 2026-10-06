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
  const chainable = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockResolvedValue([]),
    limit: vi.fn().mockResolvedValue([]),
  };
  return chainable as unknown as Database & typeof chainable;
}

// markup=2 means convertRetail doubles the wholesale price
function createFxMock(markup = 2) {
  return {
    markup,
    getRate: vi.fn().mockResolvedValue(0.85),
    convert: vi.fn().mockImplementation(
      (amount: string) => Promise.resolve((parseFloat(amount) * 0.85).toFixed(2)),
    ),
    convertRetail: vi.fn().mockImplementation(
      (amount: string) => Promise.resolve((parseFloat(amount) * markup).toFixed(2)),
    ),
  } as unknown as FxService & {
    markup: number;
    getRate: ReturnType<typeof vi.fn>;
    convert: ReturnType<typeof vi.fn>;
    convertRetail: ReturnType<typeof vi.fn>;
  };
}

const sampleListingRow = {
  listingId: '00000000-0000-0000-0000-000000000001',
  sellerPriceUsd: '12.50',
  amsPriceUsd: '14.00',
  boxQuantity: 25,
  availableStems: 2500, // 100 boxes × 25 stems/box
  deliveryDate: '2026-04-15',
  productId: '00000000-0000-0000-0000-000000000010',
  productName: { en: 'Pink Mondial', ru: 'Розовая Мондиаль' },
  productSlug: 'pink-mondial',
  productSpecies: 'Rose',
  productColor: 'Pink',
  productImageUrl: 'https://example.com/pink.jpg',
  productDescription: { en: 'Premium rose', ru: 'Премиальная роза' },
  sellerId: '00000000-0000-0000-0000-000000000100',
  sellerName: { en: 'Flores de Colombia', ru: 'Флорес де Коломбия' },
  sellerSlug: 'flores-de-colombia',
  sellerCountry: 'CO',
  sellerVerified: true,
  sellerLogoUrl: 'https://example.com/logo.png',
  categoryId: '00000000-0000-0000-0000-000000000200',
  categoryName: { en: 'Roses', ru: 'Розы' },
  categorySlug: 'roses',
};

// Row with easy-math values for segment tests:
// wholesale=0.85, markup=2 → retail=1.70; available_stems=2000, box_quantity=200 → boxes=10
const segmentTestRow = {
  ...sampleListingRow,
  sellerPriceUsd: '0.85',
  amsPriceUsd: '0.70',
  boxQuantity: 200,
  availableStems: 2000,
};

// validBaseQuery used in segment-specific tests (segment will be overridden)
const validBaseQuery = {
  sort: 'newest' as const,
  currency: 'KZT' as const,
  lang: 'en',
  page: 1,
  limit: 20,
  segment: 'b2b' as const,
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
    it('returns paginated listings with correct shape', async () => {
      vi.mocked(queryListings).mockResolvedValue({
        rows: [sampleListingRow],
        total: 42,
        facets: [
          {
            categoryId: '00000000-0000-0000-0000-000000000200',
            categoryName: { en: 'Roses', ru: 'Розы' },
            categorySlug: 'roses',
            count: 15,
          },
        ],
      });

      const result = await service.getListings({
        sort: 'newest',
        currency: 'TRY',
        lang: 'en',
        page: 2,
        limit: 20,
        segment: 'b2b',
      });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(42);
      expect(result.page).toBe(2);
      expect(result.page_size).toBe(20);
      expect(result.has_next).toBe(true);
      expect(result.facets.categories).toHaveLength(1);
      expect(result.facets.categories[0]).toEqual({
        slug: 'roses',
        name: 'Roses',
        count: 15,
      });
    });

    it('converts min_price/max_price to USD before query (no price_currency override)', async () => {
      vi.mocked(queryListings).mockResolvedValue({ rows: [], total: 0, facets: [] });
      fx.getRate.mockResolvedValue(32.5);

      await service.getListings({
        min_price: 10,
        max_price: 20,
        sort: 'newest',
        currency: 'TRY',
        lang: 'en',
        page: 1,
        limit: 20,
        segment: 'b2b',
      });

      const callArgs = vi.mocked(queryListings).mock.calls[0]!;
      const filters = callArgs[1];
      expect(filters.minPriceUsd).toBeCloseTo(10 / 32.5, 5);
      expect(filters.maxPriceUsd).toBeCloseTo(20 / 32.5, 5);
    });

    it('treats min_price/max_price as already-USD when price_currency=USD', async () => {
      // The frontend stores the user's price filter in a canonical currency
      // (USD) so it survives changes to the display currency. When the user
      // is browsing in TRY, the filter still needs to mean ">= 10 USD".
      vi.mocked(queryListings).mockResolvedValue({ rows: [], total: 0, facets: [] });
      fx.getRate.mockResolvedValue(32.5)

      await service.getListings({
        min_price: 10,
        max_price: 20,
        price_currency: 'USD',
        sort: 'newest',
        currency: 'TRY',
        lang: 'en',
        page: 1,
        limit: 20,
        segment: 'b2b',
      });

      const callArgs = vi.mocked(queryListings).mock.calls[0]!;
      const filters = callArgs[1];
      // No division by the TRY rate — values pass through as USD.
      expect(filters.minPriceUsd).toBe(10);
      expect(filters.maxPriceUsd).toBe(20);
    });

    it('uses price_currency rate, not display currency rate, when they differ', async () => {
      // currency=KZT (display), price_currency=TRY (filter input).
      // The filter rate must come from TRY, not from KZT.
      vi.mocked(queryListings).mockResolvedValue({ rows: [], total: 0, facets: [] });
      fx.getRate.mockImplementation((target: string) =>
        Promise.resolve(target === 'TRY' ? 32.5 : 1),
      );

      await service.getListings({
        min_price: 325,
        price_currency: 'TRY',
        sort: 'newest',
        currency: 'KZT',
        lang: 'en',
        page: 1,
        limit: 20,
        segment: 'b2b',
      });

      const callArgs = vi.mocked(queryListings).mock.calls[0]!;
      const filters = callArgs[1];
      // 325 TRY / 32.5 = 10 USD
      expect(filters.minPriceUsd).toBeCloseTo(10, 5);
    });

    it('fetches FX when display currency is KZT', async () => {
      vi.mocked(queryListings).mockResolvedValue({ rows: [], total: 0, facets: [] });

      await service.getListings({
        sort: 'newest',
        currency: 'KZT',
        lang: 'en',
        page: 1,
        limit: 20,
        segment: 'b2b',
      });

      expect(fx.getRate).toHaveBeenCalledWith('KZT');
    });

    it('passes category filter as slug', async () => {
      vi.mocked(queryListings).mockResolvedValue({ rows: [], total: 0, facets: [] });

      await service.getListings({
        category: 'roses',
        sort: 'newest',
        currency: 'KZT',
        lang: 'en' as const,
        page: 1,
        limit: 20,
        segment: 'b2b',
      });

      const callArgs = vi.mocked(queryListings).mock.calls[0]!;
      expect(callArgs[1].categorySlug).toBe('roses');
    });

    it('passes collection filter as slug', async () => {
      vi.mocked(queryListings).mockResolvedValue({ rows: [], total: 0, facets: [] });

      await service.getListings({
        collection: 'best-sellers',
        sort: 'newest',
        currency: 'KZT',
        lang: 'en',
        page: 1,
        limit: 20,
        segment: 'b2b',
      });

      const callArgs = vi.mocked(queryListings).mock.calls[0]!;
      expect(callArgs[1].collectionSlug).toBe('best-sellers');
    });

    it('returns empty items with total 0 when no results', async () => {
      vi.mocked(queryListings).mockResolvedValue({ rows: [], total: 0, facets: [] });

      const result = await service.getListings({
        sort: 'newest',
        currency: 'KZT',
        page: 999,
        limit: 20,
        segment: 'b2b',
      });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('maps listing row to correct response shape', async () => {
      vi.mocked(queryListings).mockResolvedValue({
        rows: [sampleListingRow],
        total: 1,
        facets: [],
      });
      fx.convert.mockImplementation((amount: string) =>
        Promise.resolve(amount),
      );

      const result = await service.getListings({
        sort: 'newest',
        currency: 'KZT',
        lang: 'en',
        page: 1,
        limit: 20,
        segment: 'b2b',
      });

      const item = result.items[0]!;
      expect(item.id).toBe(sampleListingRow.listingId);
      expect(item.product.name).toBe('Pink Mondial');
      expect(item.product.image_url).toBe('https://example.com/pink.jpg');
      expect(item.product.category_id).toBe('00000000-0000-0000-0000-000000000200');
      expect(item.seller.name).toBe('Flores de Colombia');
      expect(item.seller.slug).toBe('flores-de-colombia');
      expect(item.seller_price).toBe('12.50');
      expect(item.currency).toBe('KZT');
      // B2B shape
      expect(item.unit).toBe('box');
      expect(item.available_units).toBe(100); // 2500 / 25
    });
  });

  describe('getListings — B2C segment', () => {
    it('returns retail price (wholesale × markup) and stem unit', async () => {
      // markup=2, wholesale=0.85 → retail=1.70
      // available_stems=2000, box_quantity=200 → available_units=2000 (B2C)
      vi.mocked(queryListings).mockResolvedValue({
        rows: [segmentTestRow],
        total: 1,
        facets: [],
      });
      // Override convertRetail to use identity (currency=KZT, markup=2)
      fx.convertRetail.mockImplementation((amount: string) =>
        Promise.resolve((parseFloat(amount) * 2).toFixed(2)),
      );

      const result = await service.getListings({
        ...validBaseQuery,
        segment: 'b2c',
        currency: 'KZT',
      });

      const first = result.items[0]!;
      expect(first.seller_price).toBe('1.70');
      expect(first.ams_price).toBeNull();
      expect(first.unit).toBe('stem');
      expect(first.available_units).toBe(2000);
    });
  });

  describe('getListings — B2B segment', () => {
    it('returns wholesale price and box unit', async () => {
      vi.mocked(queryListings).mockResolvedValue({
        rows: [segmentTestRow],
        total: 1,
        facets: [],
      });
      // Override convert to pass through for KZT
      fx.convert.mockImplementation((amount: string) => Promise.resolve(amount));

      const result = await service.getListings({
        ...validBaseQuery,
        segment: 'b2b',
        currency: 'KZT',
      });

      const first = result.items[0]!;
      expect(first.seller_price).toBe('0.85');
      expect(first.ams_price).toBe('0.70');
      expect(first.unit).toBe('box');
      expect(first.available_units).toBe(10); // 2000 / 200
    });
  });

  describe('getListings — B2C price filter math divides by markup', () => {
    it('divides price bounds by markup for B2C before comparing to wholesale', async () => {
      vi.mocked(queryListings).mockResolvedValue({ rows: [], total: 0, facets: [] });
      // markup=2, price_currency=USD (rate=1), min_price=2.00 → minPriceUsd = 2/1/2 = 1.00
      await service.getListings({
        ...validBaseQuery,
        segment: 'b2c',
        currency: 'KZT',
        price_currency: 'USD',
        min_price: 2.00,
        max_price: 4.00,
      });

      const filters = vi.mocked(queryListings).mock.calls[0]![1];
      expect(filters.minPriceUsd).toBeCloseTo(1.0, 5);
      expect(filters.maxPriceUsd).toBeCloseTo(2.0, 5);
    });
  });

  describe('getProductBySlug', () => {
    const sampleProduct = {
      id: '00000000-0000-0000-0000-000000000010',
      name: { en: 'Pink Mondial', ru: 'Розовая Мондиаль' },
      slug: 'pink-mondial',
      species: 'Rose',
      color: 'Pink',
      stemLengthCm: 60,
      headSize: 'Medium',
      imageUrl: 'https://example.com/pink.jpg',
      description: { en: 'Premium rose', ru: 'Премиальная роза' },
      categoryId: '00000000-0000-0000-0000-000000000200',
      categoryName: { en: 'Roses', ru: 'Розы' },
      categorySlug: 'roses',
    };

    const sampleProductListing = {
      id: '00000000-0000-0000-0000-000000000001',
      sellerPriceUsd: '12.50',
      amsPriceUsd: '14.00',
      boxQuantity: 25,
      availableStems: 2500, // 100 boxes × 25 stems/box
      deliveryDate: '2026-04-15',
      sellerId: '00000000-0000-0000-0000-000000000100',
      sellerName: { en: 'Flores de Colombia', ru: 'Флорес де Коломбия' },
      sellerSlug: 'flores-de-colombia',
      sellerCountry: 'CO',
      sellerVerified: true,
      sellerLogoUrl: null,
    };

    it('returns product with converted listing prices', async () => {
      vi.mocked(queryProductBySlug).mockResolvedValue({
        product: sampleProduct,
        listings: [sampleProductListing],
      });

      const result = await service.getProductBySlug('pink-mondial', 'TRY', 'en');

      expect(result.name).toBe('Pink Mondial');
      expect(result.image_url).toBe('https://example.com/pink.jpg');
      expect(result.category).toEqual({ name: 'Roses', slug: 'roses' });
      expect(result.listings).toHaveLength(1);
      expect(fx.convert).toHaveBeenCalledWith('12.50', 'TRY');
    });

    it('returns B2B shape by default (unit=box, ams_price set)', async () => {
      vi.mocked(queryProductBySlug).mockResolvedValue({
        product: sampleProduct,
        listings: [sampleProductListing],
      });
      fx.convert.mockImplementation((amount: string) => Promise.resolve(amount));

      const result = await service.getProductBySlug('pink-mondial', 'KZT', 'en', 'b2b');

      const l = result.listings[0]!;
      expect(l.unit).toBe('box');
      expect(l.available_units).toBe(100); // 2500 / 25
      expect(l.ams_price).toBe('14.00');
    });

    it('returns B2C shape when segment=b2c (unit=stem, ams_price null)', async () => {
      vi.mocked(queryProductBySlug).mockResolvedValue({
        product: sampleProduct,
        listings: [sampleProductListing],
      });
      fx.convertRetail.mockImplementation((amount: string) =>
        Promise.resolve((parseFloat(amount) * 2).toFixed(2)),
      );

      const result = await service.getProductBySlug('pink-mondial', 'KZT', 'en', 'b2c');

      const l = result.listings[0]!;
      expect(l.unit).toBe('stem');
      expect(l.available_units).toBe(2500);
      expect(l.ams_price).toBeNull();
      expect(l.seller_price).toBe('25.00'); // 12.50 × 2
    });

    it('throws NotFoundError when slug does not exist', async () => {
      vi.mocked(queryProductBySlug).mockResolvedValue({
        product: null,
        listings: [],
      });

      await expect(
        service.getProductBySlug('nonexistent', 'KZT', 'en'),
      ).rejects.toThrow('Product not found');
    });

    it('returns product with empty listings array when no active listings', async () => {
      vi.mocked(queryProductBySlug).mockResolvedValue({
        product: sampleProduct,
        listings: [],
      });

      const result = await service.getProductBySlug('pink-mondial', 'KZT', 'en');

      expect(result.listings).toEqual([]);
    });

  });

  describe('getSellers', () => {
    it('returns all sellers sorted by name', async () => {
      const sellerRow = {
        id: '00000000-0000-0000-0000-000000000100',
        name: { en: 'Flores de Colombia', ru: 'Флорес де Коломбия' },
        slug: 'flores-de-colombia',
        country: 'CO',
        rating: 4,
        logoUrl: 'https://example.com/logo.png',
        verified: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      db.orderBy.mockResolvedValue([sellerRow]);

      const result = await service.getSellers('en');

      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe('Flores de Colombia');
      expect(result[0]!.slug).toBe('flores-de-colombia');
      expect(result[0]!.logo_url).toBe('https://example.com/logo.png');
      expect(fx.convert).not.toHaveBeenCalled();
    });
  });

  describe('getCollections', () => {
    it('returns active collections sorted by sortOrder', async () => {
      const collectionRow = {
        id: '00000000-0000-0000-0000-000000001000',
        name: { en: "Valentine's Day", ru: 'День святого Валентина' },
        slug: 'valentines-day',
        imageUrl: 'https://example.com/val.jpg',
      };
      // First select().from().where().orderBy() → collection rows
      db.orderBy.mockResolvedValueOnce([collectionRow]);
      // Second select().from().innerJoin().where().groupBy() → count rows
      db.groupBy.mockResolvedValueOnce([]);

      const result = await service.getCollections('en');

      expect(result).toHaveLength(1);
      expect(result[0]!.slug).toBe('valentines-day');
      expect(result[0]!.image_url).toBe('https://example.com/val.jpg');
      expect(result[0]!.product_count).toBe(0);
    });
  });

  describe('getCollectionBySlug', () => {
    it('returns collection with converted item prices', async () => {
      vi.mocked(queryCollectionBySlug).mockResolvedValue({
        collection: {
          id: '00000000-0000-0000-0000-000000001000',
          name: { en: "Valentine's Day", ru: 'День святого Валентина' },
          slug: 'valentines-day',
          type: 'seasonal',
          imageUrl: null,
        },
        items: [{ ...sampleListingRow, sortOrder: 1 }],
      });

      const result = await service.getCollectionBySlug('valentines-day', 'TRY', 'en');

      expect(result.name).toBe("Valentine's Day");
      expect(result.image_url).toBeNull();
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.sort_order).toBe(1);
      expect(fx.convert).toHaveBeenCalled();
    });

    it('throws NotFoundError when collection slug does not exist', async () => {
      vi.mocked(queryCollectionBySlug).mockResolvedValue({
        collection: null,
        items: [],
      });

      await expect(
        service.getCollectionBySlug('nonexistent', 'KZT', 'en'),
      ).rejects.toThrow('Collection not found');
    });

    it('returns B2C items when segment=b2c', async () => {
      vi.mocked(queryCollectionBySlug).mockResolvedValue({
        collection: {
          id: '00000000-0000-0000-0000-000000001000',
          name: { en: "Valentine's Day", ru: 'День святого Валентина' },
          slug: 'valentines-day',
          type: 'seasonal',
          imageUrl: null,
        },
        items: [{ ...segmentTestRow, sortOrder: 1 }],
      });
      fx.convertRetail.mockImplementation((amount: string) =>
        Promise.resolve((parseFloat(amount) * 2).toFixed(2)),
      );

      const result = await service.getCollectionBySlug('valentines-day', 'KZT', 'en', 'b2c');

      const item = result.items[0]!;
      expect(item.unit).toBe('stem');
      expect(item.available_units).toBe(2000);
      expect(item.ams_price).toBeNull();
      expect(item.seller_price).toBe('1.70'); // 0.85 × 2
    });
  });

  describe('getCategories', () => {
    it('returns categories with active listing counts, excluding empty ones', async () => {
      const categoryRows = [
        { id: 'cat-1', name: { en: 'Roses', ru: 'Розы' }, slug: 'roses' },
        { id: 'cat-2', name: { en: 'Tulips', ru: 'Тюльпаны' }, slug: 'tulips' },
        { id: 'cat-3', name: { en: 'Lilies', ru: 'Лилии' }, slug: 'lilies' },
      ];
      const countRows = [
        { categoryId: 'cat-1', count: 15 },
        { categoryId: 'cat-2', count: 3 },
      ];
      db.orderBy.mockResolvedValueOnce(categoryRows);
      db.groupBy.mockResolvedValueOnce(countRows);

      const result = await service.getCategories('en');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'cat-1',
        name: 'Roses',
        slug: 'roses',
        product_count: 15,
      });
      expect(result[1]).toEqual({
        id: 'cat-2',
        name: 'Tulips',
        slug: 'tulips',
        product_count: 3,
      });
    });

    it('resolves names to requested locale', async () => {
      db.orderBy.mockResolvedValueOnce([
        { id: 'cat-1', name: { en: 'Roses', ru: 'Розы' }, slug: 'roses' },
      ]);
      db.groupBy.mockResolvedValueOnce([{ categoryId: 'cat-1', count: 5 }]);

      const result = await service.getCategories('ru');

      expect(result[0]!.name).toBe('Розы');
    });

    it('returns empty array when no categories have active listings', async () => {
      db.orderBy.mockResolvedValueOnce([
        { id: 'cat-1', name: { en: 'Roses', ru: 'Розы' }, slug: 'roses' },
      ]);
      db.groupBy.mockResolvedValueOnce([]);

      const result = await service.getCategories('en');

      expect(result).toEqual([]);
    });
  });
});

describe('Florelle exact native prices',()=>{
 it('uses stored RUB retail/wholesale/reference independently from rounded USD or markup',async()=>{
  const fx=createFxMock(99); const service=new CatalogService(createDbMock(),fx);
  vi.mocked(queryListings).mockResolvedValue({rows:[{...sampleListingRow,priceCurrency:'RUB',retailPrice:'137.11',wholesalePrice:'54.84',referencePrice:'70.87',productPhoto:{url:'/media/a.webp',variants:[{src:'/media/b.webp',width:640,height:640}]} } as any],total:1,facets:[]});
  const result=await service.getListings({...validBaseQuery,currency:'RUB',segment:'b2c'});
  expect(result.items[0]?.seller_price).toBe('137.11');
  expect(result.items[0]?.wholesale).toEqual({seller_price:'54.84',ams_price:'70.87',available_units:100});
  expect(result.items[0]?.photo?.variants[0]?.src).toBe('/media/b.webp');
 });
});
