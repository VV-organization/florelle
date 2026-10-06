import { describe, expect, it, vi, beforeEach } from 'vitest';
import { OrdersService, type OrdersServiceConfig } from '../orders.service';
import type { Database } from '../../../shared/db/client';
import type { FxService } from '../../../shared/currency/fx.service';
import { listings } from '../../../shared/db/schema/listings';
import type { PaymentProvider } from '../../payments/payment-provider';
import { payments } from '../../../shared/db/schema/payments';

function createDbMock() {
  const db = {
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    for: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };
  return db as unknown as Database & typeof db;
}

function createFxMock(markup = 2) {
  return {
    getRate: vi.fn().mockResolvedValue(100),
    convert: vi.fn().mockImplementation((amount: string) => Promise.resolve(amount)),
    convertRetail: vi.fn().mockImplementation((amount: string) =>
      Promise.resolve((parseFloat(amount) * markup).toFixed(2)),
    ),
    markup,
  } as unknown as FxService & {
    getRate: ReturnType<typeof vi.fn>;
    convert: ReturnType<typeof vi.fn>;
    convertRetail: ReturnType<typeof vi.fn>;
    markup: number;
  };
}

function createPaymentProviderMock() {
  return {
    createPayment: vi.fn().mockResolvedValue({
      externalId: 'arcopay-order-1',
      paymentUrl: 'https://qr.nspk.ru/direct-order-1',
    }),
    getPaymentUrl: vi.fn(),
    verifyWebhookSignature: vi.fn(),
    parseWebhookPayload: vi.fn(),
  } as unknown as PaymentProvider & {
    createPayment: ReturnType<typeof vi.fn>;
  };
}

const testConfig: OrdersServiceConfig = {
  commissionPercent: 12,
  cartTtlHours: 24,
  callbackUrl: 'https://api.flower-point.test/api/v1/payments/callback',
  successUrl: 'https://flower-point.test/orders/{orderId}',
  failUrl: 'https://flower-point.test/orders/{orderId}',
};

const userId = '00000000-0000-0000-0000-000000000001';
const individualUserId = '00000000-0000-0000-0000-000000000002';

describe('OrdersService', () => {
  const createOrderInput = {
    shippingAddress: {
      address: '123 Flower Ave, Miami, FL 33101',
      contactName: 'John Smith',
      contactPhone: '+1-305-555-0100',
    },
    delivery: {
      countryCode: 'RU' as const,
      cityValue: 'Moscow',
    },
    notes: 'Leave at reception',
    displayCurrency: 'RUB' as const,
    segment: 'b2b' as const,
  };

  let db: ReturnType<typeof createDbMock>;
  let fx: ReturnType<typeof createFxMock>;
  let paymentProvider: ReturnType<typeof createPaymentProviderMock>;
  let service: OrdersService;

  function createOutboxMock() {
    return {
      enqueueOrderEvent: vi.fn().mockResolvedValue({ id: 'outbox-1' }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    db = createDbMock();
    fx = createFxMock();
    paymentProvider = createPaymentProviderMock();
    service = new OrdersService(db, fx, paymentProvider, testConfig);
  });

  /** Enqueue a user-lookup result for assertSegmentMatchesUser (always the first limit() call in entry-points). */
  function mockUserLookup(customerType: 'legal_entity' | 'individual') {
    db.limit.mockResolvedValueOnce([{ customerType }]);
  }

  it('instantiates', () => {
    expect(service).toBeInstanceOf(OrdersService);
  });

  describe('addCartItem', () => {
    const listingId = '00000000-0000-0000-0000-000000000010';

    const activeListing = {
      id: listingId,
      isActive: true,
    };

    const cartRow = {
      id: '00000000-0000-0000-0000-000000000100',
      userId,
      checkoutMerchantOrderId: null,
      checkoutClaimedAt: null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdAt: new Date(),
    };

    const cartItemRow = {
      id: '00000000-0000-0000-0000-000000001000',
      cartId: cartRow.id,
      listingId,
      quantity: 3, // DB column
      createdAt: new Date(),
    };

    it('creates cart and item on first add', async () => {
      mockUserLookup('legal_entity');
      // Listing lookup: active
      db.limit.mockResolvedValueOnce([activeListing]);
      // Existing cart lookup: none
      db.for.mockResolvedValueOnce([]);
      // Insert cart: returns new cart
      db.returning.mockResolvedValueOnce([cartRow]);
      // Duplicate cart item check: none
      db.limit.mockResolvedValueOnce([]);
      // Insert cart item: returns the new item
      db.returning.mockResolvedValueOnce([cartItemRow]);

      const result = await service.addCartItem(userId, {
        listingId,
        quantity: 3,
        segment: 'b2b',
      });

      expect(result.id).toBe(cartItemRow.id);
      expect(result.listingId).toBe(listingId);
      expect(result.quantity).toBe(3);
    });

    it('throws ListingUnavailableError when listing is inactive', async () => {
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([{ id: listingId, isActive: false }]);

      await expect(
        service.addCartItem(userId, { listingId, quantity: 1, segment: 'b2b' }),
      ).rejects.toThrow('Listing is no longer available');
    });

    it('throws ItemAlreadyInCartError when listing already in cart', async () => {
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([activeListing]);
      db.for.mockResolvedValueOnce([cartRow]); // existing active cart
      db.limit.mockResolvedValueOnce([{ id: 'existing-cart-item-id' }]); // duplicate exists

      await expect(
        service.addCartItem(userId, { listingId, quantity: 1, segment: 'b2b' }),
      ).rejects.toThrow('This listing is already in your cart');
    });

    it('rejects adding an item while checkout owns the cart', async () => {
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([activeListing]);
      db.for.mockResolvedValueOnce([{
        ...cartRow,
        checkoutMerchantOrderId: 'FL-20260713-CHECKOUT',
        checkoutClaimedAt: new Date(),
      }]);

      await expect(
        service.addCartItem(userId, { listingId, quantity: 1, segment: 'b2b' }),
      ).rejects.toMatchObject({
        code: 'CHECKOUT_IN_PROGRESS',
        statusCode: 409,
      });

      expect(db.insert).not.toHaveBeenCalledWith(expect.anything());
    });

    it('reconciles a stale pending checkout before adding an item', async () => {
      const staleOrderId = '00000000-0000-0000-0000-000000000090';
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([activeListing]);
      db.where
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          listingId,
          reservedStems: 75,
        }])
        .mockReturnValueOnce(db);
      db.for
        .mockResolvedValueOnce([{
          ...cartRow,
          checkoutMerchantOrderId: 'FL-20260713-STALE',
          checkoutClaimedAt: new Date(Date.now() - 16 * 60 * 1000),
        }])
        .mockResolvedValueOnce([{
          id: staleOrderId,
          status: 'pending' as const,
          merchantOrderId: 'FL-20260713-STALE',
        }])
        .mockResolvedValueOnce([{
          id: listingId,
          availableStems: 2425,
        }]);
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([cartItemRow]);

      const result = await service.addCartItem(userId, {
        listingId,
        quantity: 3,
        segment: 'b2b',
      });

      expect(result.id).toBe(cartItemRow.id);
      expect(db.set).toHaveBeenCalledWith({ availableStems: 2500 });
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
      expect(db.set).toHaveBeenCalledWith({
        checkoutMerchantOrderId: null,
        checkoutClaimedAt: null,
      });
    });

    it('clears a stale cancelled checkout before adding an item', async () => {
      const merchantOrderId = 'FL-20260713-CANCELLED';
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([activeListing]);
      db.for
        .mockResolvedValueOnce([{
          ...cartRow,
          checkoutMerchantOrderId: merchantOrderId,
          checkoutClaimedAt: new Date(Date.now() - 16 * 60 * 1000),
        }])
        .mockResolvedValueOnce([{
          id: '00000000-0000-0000-0000-000000000090',
          status: 'cancelled' as const,
        }]);
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([cartItemRow]);

      await expect(service.addCartItem(userId, {
        listingId,
        quantity: 3,
        segment: 'b2b',
      })).resolves.toMatchObject({ id: cartItemRow.id });

      expect(db.set).toHaveBeenCalledWith({
        checkoutMerchantOrderId: null,
        checkoutClaimedAt: null,
      });
      expect(db.set).not.toHaveBeenCalledWith(expect.objectContaining({
        availableStems: expect.any(Number),
      }));
    });

    it.each(['paid', 'shipped', 'delivered'] as const)(
      'preserves a stale %s checkout claim and rejects cart mutation',
      async (status) => {
        const merchantOrderId = `FL-20260713-${status.toUpperCase()}`;
        mockUserLookup('legal_entity');
        db.limit.mockResolvedValueOnce([activeListing]);
        db.for
          .mockResolvedValueOnce([{
            ...cartRow,
            checkoutMerchantOrderId: merchantOrderId,
            checkoutClaimedAt: new Date(Date.now() - 16 * 60 * 1000),
          }])
          .mockResolvedValueOnce([{
            id: '00000000-0000-0000-0000-000000000090',
            status,
          }]);
        db.limit.mockResolvedValueOnce([]);
        db.returning.mockResolvedValueOnce([cartItemRow]);

        await expect(service.addCartItem(userId, {
          listingId,
          quantity: 3,
          segment: 'b2b',
        })).rejects.toMatchObject({
          code: 'CHECKOUT_CLAIM_INVARIANT',
        });

        expect(db.set).not.toHaveBeenCalledWith({
          checkoutMerchantOrderId: null,
          checkoutClaimedAt: null,
        });
        expect(db.returning).not.toHaveBeenCalled();
      },
    );
  });

  describe('segment validation', () => {
    const listingId = '00000000-0000-0000-0000-000000000010';

    it('rejects b2c body from a legal_entity user with SEGMENT_MISMATCH', async () => {
      mockUserLookup('legal_entity');

      await expect(
        service.addCartItem(userId, { listingId, quantity: 1, segment: 'b2c' }),
      ).rejects.toMatchObject({
        code: 'SEGMENT_MISMATCH',
        statusCode: 403,
      });
    });

    it('rejects b2b body from an individual user with SEGMENT_MISMATCH', async () => {
      mockUserLookup('individual');

      await expect(
        service.addCartItem(individualUserId, { listingId, quantity: 1, segment: 'b2b' }),
      ).rejects.toMatchObject({
        code: 'SEGMENT_MISMATCH',
        statusCode: 403,
      });
    });

    it('accepts matching segment (legal_entity + b2b)', async () => {
      mockUserLookup('legal_entity');
      const cartRow = {
        id: '00000000-0000-0000-0000-000000000100',
        userId,
        checkoutMerchantOrderId: null,
        checkoutClaimedAt: null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdAt: new Date(),
      };
      const cartItemRow = {
        id: '00000000-0000-0000-0000-000000001000',
        cartId: cartRow.id,
        listingId,
        quantity: 1,
        createdAt: new Date(),
      };
      // listing lookup
      db.limit.mockResolvedValueOnce([{ id: listingId, isActive: true }]);
      // existing cart lookup: none → triggers insert
      db.for.mockResolvedValueOnce([]);
      // insert cart
      db.returning.mockResolvedValueOnce([cartRow]);
      // duplicate item check: none
      db.limit.mockResolvedValueOnce([]);
      // insert cart item
      db.returning.mockResolvedValueOnce([cartItemRow]);

      await expect(
        service.addCartItem(userId, { listingId, quantity: 1, segment: 'b2b' }),
      ).resolves.toMatchObject({ quantity: 1 });
    });
  });

  describe('getCart', () => {
    const cartId = '00000000-0000-0000-0000-000000000100';
    const listingId = '00000000-0000-0000-0000-000000000010';

    const validCart = {
      id: cartId,
      userId,
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      createdAt: new Date(),
    };

    const joinedItemRow = {
      cartItemId: '00000000-0000-0000-0000-000000001000',
      quantity: 2, // DB column
      listingId,
      sellerPriceUsd: '12.50',
      amsPriceUsd: '14.00',
      boxQuantity: 25,
      availableStems: 2500, // 100 boxes × 25 stems/box
      deliveryDate: '2026-04-20',
      productId: '00000000-0000-0000-0000-000000000200',
      productName: { en: 'Pink Mondial', ru: 'Розовая Мондиаль' },
      productSlug: 'pink-mondial',
      productSpecies: 'Rose',
      productColor: 'Pink',
      productImageUrl: 'https://example.com/pink.jpg',
      sellerId: '00000000-0000-0000-0000-000000000300',
      sellerName: { en: 'Flores de Colombia', ru: 'Флорес де Коломбия' },
      sellerCountry: 'CO',
      sellerVerified: true,
    };

    it('returns cart with items, subtotal, commission, total', async () => {
      mockUserLookup('legal_entity'); // segment derived from user.customerType
      // Cart lookup: .select().from(carts).where(...).limit(1) — limit is the terminal
      db.limit.mockResolvedValueOnce([validCart]);
      // The user lookup's .where() is the 1st call; cart lookup's .where() is the 2nd
      // (must stay chainable for .limit); items query's .where() is the 3rd (terminal).
      db.where.mockReturnValueOnce(db);
      db.where.mockReturnValueOnce(db);
      db.where.mockResolvedValueOnce([joinedItemRow]);

      const result = await service.getCart(userId, 'USD', 'en');

      expect(result.id).toBe(cartId);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.quantity).toBe(2);
      expect(result.items[0]!.lineTotal).toBe('625.00'); // 12.50 × 25 × 2
      expect(result.subtotal).toBe('625.00');
      expect(result.commission).toBe('75.00'); // 625 × 0.12
      expect(result.total).toBe('700.00');
    });

    it('throws CartNotFoundError when user has no cart', async () => {
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([]);

      await expect(service.getCart(userId, 'USD', 'en')).rejects.toThrow(
        'Cart not found',
      );
    });

    it('throws CartExpiredError when cart is expired', async () => {
      mockUserLookup('legal_entity');
      const expiredCart = {
        ...validCart,
        expiresAt: new Date(Date.now() - 1000),
      };
      db.limit.mockResolvedValueOnce([expiredCart]);

      await expect(service.getCart(userId, 'USD', 'en')).rejects.toThrow(
        'Cart has expired',
      );
    });

    it('rounds commission to 2 decimal places', async () => {
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([validCart]);
      // 1st where: user lookup; 2nd: cart lookup (chainable for .limit); 3rd: items join terminal
      db.where.mockReturnValueOnce(db);
      db.where.mockReturnValueOnce(db);
      db.where.mockResolvedValueOnce([
        { ...joinedItemRow, sellerPriceUsd: '10.33', quantity: 3 }, // DB column
      ]);

      const result = await service.getCart(userId, 'USD', 'en');

      // 10.33 × 25 × 3 = 774.75; commission = 774.75 × 0.12 = 92.97
      expect(result.subtotal).toBe('774.75');
      expect(result.commission).toBe('92.97');
      expect(result.total).toBe('867.72');
    });

    it('uses retail markup for B2C cart totals to match checkout order math', async () => {
      mockUserLookup('individual');
      db.limit.mockResolvedValueOnce([validCart]);
      // 1st where: user lookup; 2nd: cart lookup (chainable for .limit); 3rd: items join terminal
      db.where.mockReturnValueOnce(db);
      db.where.mockReturnValueOnce(db);
      db.where.mockResolvedValueOnce([
        {
          ...joinedItemRow,
          sellerPriceUsd: '0.85',
          amsPriceUsd: '1.00',
          boxQuantity: 200,
          availableStems: 2000,
          quantity: 15,
        },
      ]);

      const result = await service.getCart(individualUserId, 'USD', 'en');

      // createOrder uses the same B2C math: 0.85 × markup 2 × 15 = 25.50
      expect(result.items[0]!.listing.sellerPrice).toBe('1.70');
      expect(result.items[0]!.lineTotal).toBe('25.50');
      expect(result.subtotal).toBe('25.50');
      expect(result.commission).toBe('3.06');
      expect(result.total).toBe('28.56');
    });
  });

  describe('updateCartItem', () => {
    const cartItemId = '00000000-0000-0000-0000-000000001000';

    it('updates quantity for owned cart item', async () => {
      mockUserLookup('legal_entity');
      db.for.mockResolvedValueOnce([{
        id: cartItemId,
        checkoutMerchantOrderId: null,
      }]);
      db.returning.mockResolvedValueOnce([{
        id: cartItemId,
        cartId: '00000000-0000-0000-0000-000000000100',
        listingId: '00000000-0000-0000-0000-000000000010',
        quantity: 5, // DB column
        createdAt: new Date(),
      }]);

      const result = await service.updateCartItem(userId, cartItemId, { quantity: 5, segment: 'b2b' });

      expect(result.quantity).toBe(5);
    });

    it('throws CartItemNotFoundError when item does not belong to user', async () => {
      mockUserLookup('legal_entity');
      db.for.mockResolvedValueOnce([]);

      await expect(
        service.updateCartItem(userId, cartItemId, { quantity: 5, segment: 'b2b' }),
      ).rejects.toThrow('Cart item not found');
    });

    it('rejects quantity changes while checkout owns the cart', async () => {
      mockUserLookup('legal_entity');
      db.for.mockResolvedValueOnce([{
        id: cartItemId,
        checkoutMerchantOrderId: 'FL-20260713-CHECKOUT',
        checkoutClaimedAt: new Date(),
      }]);

      await expect(
        service.updateCartItem(userId, cartItemId, { quantity: 5, segment: 'b2b' }),
      ).rejects.toMatchObject({
        code: 'CHECKOUT_IN_PROGRESS',
        statusCode: 409,
      });

      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('removeCartItem', () => {
    const cartItemId = '00000000-0000-0000-0000-000000001000';

    it('removes cart item owned by user', async () => {
      // ownership check: select().from().innerJoin().where().limit(1)
      db.for.mockResolvedValueOnce([{
        id: cartItemId,
        checkoutMerchantOrderId: null,
      }]);
      // delete().where() uses default mockReturnThis — no extra setup needed

      await expect(
        service.removeCartItem(userId, cartItemId),
      ).resolves.toBeUndefined();

      expect(db.delete).toHaveBeenCalled();
    });

    it('rejects removal while checkout owns the cart', async () => {
      db.for.mockResolvedValueOnce([{
        id: cartItemId,
        checkoutMerchantOrderId: 'FL-20260713-CHECKOUT',
        checkoutClaimedAt: new Date(),
      }]);

      await expect(
        service.removeCartItem(userId, cartItemId),
      ).rejects.toMatchObject({
        code: 'CHECKOUT_IN_PROGRESS',
        statusCode: 409,
      });

      expect(db.delete).not.toHaveBeenCalled();
    });
  });

  describe('createOrder', () => {
    const cartId = '00000000-0000-0000-0000-000000000100';
    const listingId = '00000000-0000-0000-0000-000000000010';
    const sellerId = '00000000-0000-0000-0000-000000000020';
    const productId = '00000000-0000-0000-0000-000000000030';
    const orderId = '00000000-0000-0000-0000-000000000040';
    const orderItemId = '00000000-0000-0000-0000-000000000050';

    // productId is used for fixture documentation purposes
    void productId;

    const validCart = {
      id: cartId,
      userId,
      checkoutMerchantOrderId: null,
      checkoutClaimedAt: null,
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      createdAt: new Date(),
    };

    const cartItemJoined = {
      cartItemId: '00000000-0000-0000-0000-000000001000',
      quantity: 3, // DB column
      listingId,
      sellerId,
      sellerPriceUsd: '12.50',
      amsPriceUsd: '14.00',
      boxQuantity: 25,
      deliveryDate: '2026-04-20',
      isActive: true,
      availableStems: 2500, // 100 boxes × 25 stems/box
      productName: { en: 'Pink Mondial', ru: 'Розовая Мондиаль' },
    };

    const insertedOrder = {
      id: orderId,
      buyerId: userId,
      status: 'pending' as const,
      subtotalUsd: '937.50',
      commissionUsd: '112.50',
      deliveryFeeUsd: '9.00',
      estimatedDeliveryWeightKg: 7,
      estimatedDeliveryStems: 75,
      deliveryCountryCode: 'RU',
      deliveryCityValue: 'Moscow',
      totalUsd: '1059.00',
      displayCurrency: 'RUB' as const,
      shippingAddress: createOrderInput.shippingAddress,
      notes: createOrderInput.notes,
      merchantOrderId: null,
      createdAt: new Date('2026-04-10T10:00:00Z'),
      updatedAt: new Date('2026-04-10T10:00:00Z'),
    };

    const insertedOrderItem = {
      id: orderItemId,
      orderId,
      listingId,
      sellerId,
      quantity: 3, // DB column
      // B2B: unit_price = wholesale × box_quantity = 12.50 × 25 = 312.50
      unitPriceUsd: '312.50',
      totalPriceUsd: '937.50', // 312.50 × 3
      deliveryDate: '2026-04-20',
    };

    function mockCartItemsAndListingLocks(
      rows: Array<typeof cartItemJoined>,
      lockedCart = validCart,
    ) {
      db.where.mockReturnValueOnce(db);
      db.where.mockReturnValueOnce(db);
      db.where.mockReturnValueOnce(db);
      db.where.mockReturnValueOnce(db);
      db.where.mockResolvedValueOnce(rows);
      db.returning.mockResolvedValueOnce([{ id: cartId }]);
      db.for.mockResolvedValueOnce([lockedCart]);
      const rowsByListingId = new Map(rows.map((row) => [row.listingId, row]));
      for (const row of [...rowsByListingId.values()].sort((left, right) => (
        left.listingId.localeCompare(right.listingId)
      ))) {
        db.where.mockReturnValueOnce(db);
        db.for.mockResolvedValueOnce([{
          listingId: row.listingId,
          sellerId: row.sellerId,
          sellerPriceUsd: row.sellerPriceUsd,
          amsPriceUsd: row.amsPriceUsd,
          boxQuantity: row.boxQuantity,
          deliveryDate: row.deliveryDate,
          isActive: row.isActive,
          availableStems: row.availableStems,
        }]);
      }
    }

    function mockPaymentPersistence() {
      db.for
        .mockResolvedValueOnce([{ id: cartId, checkoutClaimedAt: new Date() }])
        .mockResolvedValueOnce([{ id: orderId }]);
    }

    it('sweeps stale checkout claims with skip-locked row ownership', async () => {
      const merchantOrderId = 'FL-20260713-SWEEP';
      db.limit.mockResolvedValueOnce([{ id: validCart.id }]);
      db.where
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ listingId, reservedStems: 75 }])
        .mockReturnValueOnce(db);
      db.for
        .mockResolvedValueOnce([{
          ...validCart,
          checkoutMerchantOrderId: merchantOrderId,
          checkoutClaimedAt: new Date(Date.now() - 16 * 60 * 1000),
        }])
        .mockResolvedValueOnce([{
          id: orderId,
          status: 'pending' as const,
          merchantOrderId,
        }])
        .mockResolvedValueOnce([{ id: listingId, availableStems: 2425 }]);

      await expect(service.recoverStaleCheckoutClaims(10)).resolves.toEqual({
        recoveredClaims: 1,
        failedClaims: [],
      });

      expect(db.for).toHaveBeenNthCalledWith(1, 'update', { skipLocked: true });
      expect(db.limit).toHaveBeenCalledWith(10);
      expect(db.set).toHaveBeenCalledWith({ availableStems: 2500 });
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({
        status: 'cancelled',
      }));
      expect(db.set).toHaveBeenCalledWith({
        checkoutMerchantOrderId: null,
        checkoutClaimedAt: null,
      });
    });

    it('enqueues a cancelled event when stale checkout recovery compensates an order', async () => {
      const merchantOrderId = 'FL-20260713-STALE-EVENT';
      const staleOrder = {
        ...insertedOrder,
        status: 'pending' as const,
        merchantOrderId,
      };
      const recoveredItem = {
        id: orderItemId,
        listingId,
        reservedStems: 75,
        quantity: 3,
        unitPriceUsd: '312.50',
        productName: 'Pink Mondial',
      };
      const outbox = createOutboxMock();
      service = new OrdersService(db, fx, paymentProvider, testConfig, outbox);
      db.limit.mockResolvedValueOnce([{ id: validCart.id }]);
      db.where
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([recoveredItem])
        .mockReturnValueOnce(db);
      db.for
        .mockResolvedValueOnce([{
          ...validCart,
          checkoutMerchantOrderId: merchantOrderId,
          checkoutClaimedAt: new Date(Date.now() - 16 * 60 * 1000),
        }])
        .mockResolvedValueOnce([staleOrder])
        .mockResolvedValueOnce([{ id: listingId, availableStems: 2425 }]);

      await expect(service.recoverStaleCheckoutClaims(10)).resolves.toEqual({
        recoveredClaims: 1,
        failedClaims: [],
      });

      expect(outbox.enqueueOrderEvent).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          eventType: 'order.cancelled',
          source: 'customer',
          order: staleOrder,
          items: [recoveredItem],
          payment: { status: 'pending', provider: 'arcopay', paidAt: null },
        }),
      );
    });

    it('isolates a corrupt stale claim and continues recovering the batch', async () => {
      const corruptCartId = '00000000-0000-0000-0000-000000000101';
      const validCartId = '00000000-0000-0000-0000-000000000102';
      const corruptMerchantOrderId = 'FL-20260713-CORRUPT';
      const validMerchantOrderId = 'FL-20260713-VALID';
      const staleClaimedAt = new Date(Date.now() - 16 * 60 * 1000);
      db.limit.mockResolvedValueOnce([
        { id: corruptCartId },
        { id: validCartId },
      ]);
      db.where
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ listingId, reservedStems: 75 }])
        .mockReturnValueOnce(db);
      db.for
        .mockResolvedValueOnce([{
          id: corruptCartId,
          checkoutMerchantOrderId: corruptMerchantOrderId,
          checkoutClaimedAt: staleClaimedAt,
        }])
        .mockResolvedValueOnce([{
          id: '00000000-0000-0000-0000-000000000041',
          status: 'paid' as const,
          merchantOrderId: corruptMerchantOrderId,
        }])
        .mockResolvedValueOnce([{
          id: validCartId,
          checkoutMerchantOrderId: validMerchantOrderId,
          checkoutClaimedAt: staleClaimedAt,
        }])
        .mockResolvedValueOnce([{
          id: orderId,
          status: 'pending' as const,
          merchantOrderId: validMerchantOrderId,
        }])
        .mockResolvedValueOnce([{ id: listingId, availableStems: 2425 }]);

      await expect(service.recoverStaleCheckoutClaims(10)).resolves.toEqual({
        recoveredClaims: 1,
        failedClaims: [{
          cartId: corruptCartId,
          merchantOrderId: corruptMerchantOrderId,
          errorCode: 'CHECKOUT_CLAIM_INVARIANT',
        }],
      });

      expect(db.set).toHaveBeenCalledWith({ availableStems: 2500 });
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({
        status: 'cancelled',
      }));
      expect(db.set).toHaveBeenCalledWith({
        checkoutMerchantOrderId: null,
        checkoutClaimedAt: null,
      });
    });

    it('creates a pending order and direct payment without reading balance', async () => {
      const pendingOrder = { ...insertedOrder, status: 'pending' as const };
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([validCart]);
      mockCartItemsAndListingLocks([cartItemJoined]);
      mockPaymentPersistence();
      db.returning
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([pendingOrder])
        .mockResolvedValueOnce([insertedOrderItem])
        .mockResolvedValueOnce([]);

      const result = await service.createOrder(userId, createOrderInput);

      expect(result.order.status).toBe('pending');
      expect(result.paymentUrl).toBe('https://qr.nspk.ru/direct-order-1');
      expect(paymentProvider.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          amountUsd: '1059.00',
          callbackUrl: testConfig.callbackUrl,
        }),
      );
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({
        checkoutMerchantOrderId: expect.stringMatching(/^FL-/),
        checkoutClaimedAt: expect.any(Date),
      }));
      expect(db.insert).toHaveBeenCalledWith(payments);
      expect(db.delete).toHaveBeenCalled();
      expect(
        vi.mocked(db.values).mock.calls.some(([value]) =>
          !Array.isArray(value) && (value as Record<string, unknown>).type === 'purchase',
        ),
      ).toBe(false);
    });

    it('creates a synthetic scenario order through the checkout payment path', async () => {
      const scenarioRunId = '00000000-0000-4000-8000-000000000060';
      const pendingOrder = {
        ...insertedOrder,
        status: 'pending' as const,
        synthetic: true,
        scenarioRunId,
        merchantOrderId: 'FL-20260814-SCENARIO',
      };
      const outbox = createOutboxMock();
      service = new OrdersService(db, fx, paymentProvider, testConfig, outbox);
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([validCart]);
      mockCartItemsAndListingLocks([cartItemJoined]);
      mockPaymentPersistence();
      db.returning
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([pendingOrder])
        .mockResolvedValueOnce([insertedOrderItem])
        .mockResolvedValueOnce([]);

      const result = await service.createSyntheticCheckoutPaymentReached({
        userId,
        scenarioRunId,
        request: createOrderInput,
      });

      expect(result.paymentUrl).toBe('https://qr.nspk.ru/direct-order-1');
      expect(db.values).toHaveBeenCalledWith(expect.objectContaining({
        buyerId: userId,
        synthetic: true,
        scenarioRunId,
      }));
      expect(db.set).toHaveBeenCalledWith({
        scenarioPaymentUrlHost: 'qr.nspk.ru',
      });
      expect(outbox.enqueueOrderEvent).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          eventType: 'order.created',
          source: 'scenario',
          order: pendingOrder,
        }),
      );
      expect(outbox.enqueueOrderEvent).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          eventType: 'order.payment_reached',
          source: 'scenario',
          order: pendingOrder,
        }),
      );
    });

    it('cancels a reached synthetic checkout, restores stock, and keeps its cart reusable', async () => {
      const scenarioRunId = 'cmst1syntheticrun000000000001';
      const pendingOrder = {
        ...insertedOrder,
        status: 'pending' as const,
        synthetic: true,
        scenarioRunId,
        merchantOrderId: 'FL-20260814-SCENARIO-CANCEL',
      };
      const outbox = createOutboxMock();
      service = new OrdersService(db, fx, paymentProvider, testConfig, outbox);
      db.where
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockResolvedValueOnce([{
          id: orderItemId,
          orderId: pendingOrder.id,
          listingId,
          sellerId: '00000000-0000-0000-0000-000000000030',
          quantity: 3,
          reservedStems: 75,
          unitPriceUsd: '312.50',
          totalPriceUsd: '937.50',
          deliveryDate: '2026-08-20',
          productName: 'Pink Mondial',
        }])
        .mockReturnValueOnce(db);
      db.for
        .mockResolvedValueOnce([pendingOrder])
        .mockResolvedValueOnce([{ id: cartId }])
        .mockResolvedValueOnce([{ id: '00000000-0000-0000-0000-000000000040', status: 'pending' }])
        .mockResolvedValueOnce([{ id: listingId, availableStems: 2425 }]);

      await service.cancelSyntheticCheckoutPaymentReached({
        orderId: pendingOrder.id,
        scenarioRunId,
      });

      expect(db.set).toHaveBeenCalledWith({ status: 'failed', updatedAt: expect.any(Date) });
      expect(db.set).toHaveBeenCalledWith({ availableStems: 2500 });
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
      expect(db.set).toHaveBeenCalledWith({
        checkoutMerchantOrderId: null,
        checkoutClaimedAt: null,
      });
      expect(outbox.enqueueOrderEvent).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ eventType: 'order.cancelled', source: 'scenario' }),
      );
    });

    it('enqueues created and payment-reached checkout events in their transactions', async () => {
      const pendingOrder = { ...insertedOrder, status: 'pending' as const };
      const outbox = createOutboxMock();
      service = new OrdersService(db, fx, paymentProvider, testConfig, outbox);
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([validCart]);
      mockCartItemsAndListingLocks([cartItemJoined]);
      mockPaymentPersistence();
      db.returning
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([pendingOrder])
        .mockResolvedValueOnce([insertedOrderItem]);

      await service.createOrder(userId, createOrderInput);

      expect(outbox.enqueueOrderEvent).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          eventType: 'order.created',
          source: 'customer',
          order: pendingOrder,
          items: [insertedOrderItem],
          payment: { status: 'pending', provider: 'arcopay', paidAt: null },
        }),
      );
      expect(outbox.enqueueOrderEvent).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          eventType: 'order.payment_reached',
          source: 'customer',
          order: pendingOrder,
          items: [insertedOrderItem],
          payment: { status: 'pending', provider: 'arcopay', paidAt: null },
        }),
      );
    });

    it.each([
      { externalId: '   ', paymentUrl: 'https://qr.nspk.ru/direct-order-1' },
      { externalId: 'arcopay-order-1', paymentUrl: 'http://qr.nspk.ru/direct-order-1' },
      { externalId: 'arcopay-order-1', paymentUrl: 'not-a-url' },
      { externalId: 'arcopay-order-1', paymentUrl: 'https://user:pass@qr.nspk.ru/direct-order-1' },
    ])(
      'compensates when the provider returns unusable payment data %#',
      async (providerResult) => {
        const pendingOrder = { ...insertedOrder, status: 'pending' as const };
        paymentProvider.createPayment.mockResolvedValueOnce(providerResult);
        mockUserLookup('legal_entity');
        db.limit.mockResolvedValueOnce([validCart]);
        mockCartItemsAndListingLocks([cartItemJoined]);
        db.returning
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([pendingOrder])
          .mockResolvedValueOnce([insertedOrderItem]);
        db.where
          .mockReturnValueOnce(db)
          .mockReturnValueOnce(db)
          .mockReturnValueOnce(db)
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ listingId, reservedStems: 75 }])
          .mockReturnValueOnce(db);
        db.for
          .mockResolvedValueOnce([{ id: cartId, checkoutClaimedAt: new Date() }])
          .mockResolvedValueOnce([pendingOrder])
          .mockResolvedValueOnce([{ id: listingId, availableStems: 2425 }]);

        await expect(
          service.createOrder(userId, createOrderInput),
        ).rejects.toMatchObject({ code: 'PAYMENT_CREATION_FAILED' });

        expect(db.insert).not.toHaveBeenCalledWith(payments);
        expect(db.delete).not.toHaveBeenCalled();
        expect(db.set).toHaveBeenCalledWith({ availableStems: 2500 });
        expect(db.set).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'cancelled' }),
        );
      },
    );

    it('rejects a second checkout when the cart claim cannot be acquired', async () => {
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([{
        ...validCart,
        checkoutMerchantOrderId: 'FL-20260713-FIRST',
        checkoutClaimedAt: new Date(),
      }]);
      mockCartItemsAndListingLocks([cartItemJoined], {
        ...validCart,
        checkoutMerchantOrderId: 'FL-20260713-FIRST',
        checkoutClaimedAt: new Date(),
      });

      await expect(service.createOrder(userId, createOrderInput)).rejects.toMatchObject({
        code: 'CHECKOUT_IN_PROGRESS',
        statusCode: 409,
      });

      expect(paymentProvider.createPayment).not.toHaveBeenCalled();
    });

    it('reconciles a stale pending checkout before creating a new order', async () => {
      const staleOrderId = '00000000-0000-0000-0000-000000000090';
      const pendingOrder = { ...insertedOrder, status: 'pending' as const };
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([{
        ...validCart,
        checkoutMerchantOrderId: 'FL-20260713-STALE',
        checkoutClaimedAt: new Date(Date.now() - 16 * 60 * 1000),
      }]);
      db.where
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          listingId,
          reservedStems: 75,
        }])
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockResolvedValueOnce([cartItemJoined])
        .mockReturnValueOnce(db);
      db.for
        .mockResolvedValueOnce([{
          ...validCart,
          checkoutMerchantOrderId: 'FL-20260713-STALE',
          checkoutClaimedAt: new Date(Date.now() - 16 * 60 * 1000),
        }])
        .mockResolvedValueOnce([{
          id: staleOrderId,
          status: 'pending' as const,
          merchantOrderId: 'FL-20260713-STALE',
        }])
        .mockResolvedValueOnce([{
          id: listingId,
          availableStems: 2425,
        }])
        .mockResolvedValueOnce([{
          listingId,
          sellerId,
          sellerPriceUsd: cartItemJoined.sellerPriceUsd,
          amsPriceUsd: cartItemJoined.amsPriceUsd,
          boxQuantity: cartItemJoined.boxQuantity,
          deliveryDate: cartItemJoined.deliveryDate,
          isActive: true,
          availableStems: 2500,
        }])
        .mockResolvedValueOnce([{ id: cartId, checkoutClaimedAt: new Date() }])
        .mockResolvedValueOnce([{ id: orderId }]);
      db.returning.mockResolvedValueOnce([{ id: cartId }]);
      db.returning
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([pendingOrder])
        .mockResolvedValueOnce([insertedOrderItem]);

      const result = await service.createOrder(userId, createOrderInput);

      expect(result.paymentUrl).toBe('https://qr.nspk.ru/direct-order-1');
      expect(db.set).toHaveBeenCalledWith({ availableStems: 2500 });
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
    });

    it('cancels the pending order, restores reserved stems, and preserves cart when payment creation fails', async () => {
      const pendingOrder = { ...insertedOrder, status: 'pending' as const };
      paymentProvider.createPayment.mockRejectedValueOnce(new Error('ArcPay unavailable'));
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([validCart]);
      mockCartItemsAndListingLocks([cartItemJoined]);
      db.returning
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([pendingOrder])
        .mockResolvedValueOnce([insertedOrderItem]);
      db.where.mockReturnValueOnce(db);
      db.where.mockReturnValueOnce(db);
      db.where.mockReturnValueOnce(db);
      db.where.mockResolvedValueOnce([]);
      db.where.mockResolvedValueOnce([{
        listingId,
        reservedStems: 75,
      }]);
      db.where.mockReturnValueOnce(db);
      db.for.mockResolvedValueOnce([{
        id: cartId,
        checkoutClaimedAt: new Date(),
      }]);
      db.for.mockResolvedValueOnce([pendingOrder]);
      db.for.mockResolvedValueOnce([{
        id: listingId,
        availableStems: 2425,
      }]);

      await expect(service.createOrder(userId, createOrderInput)).rejects.toMatchObject({
        code: 'PAYMENT_CREATION_FAILED',
      });

      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
      expect(db.set).toHaveBeenCalledWith({ availableStems: 2500 });
      expect(db.set).toHaveBeenCalledWith({
        checkoutMerchantOrderId: null,
        checkoutClaimedAt: null,
      });
      expect(db.delete).not.toHaveBeenCalled();
    });

    it('enqueues a cancelled event when checkout compensation succeeds', async () => {
      const pendingOrder = { ...insertedOrder, status: 'pending' as const };
      const outbox = createOutboxMock();
      service = new OrdersService(db, fx, paymentProvider, testConfig, outbox);
      paymentProvider.createPayment.mockRejectedValueOnce(new Error('ArcPay unavailable'));
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([validCart]);
      mockCartItemsAndListingLocks([cartItemJoined]);
      db.returning
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([pendingOrder])
        .mockResolvedValueOnce([insertedOrderItem]);
      db.where
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          id: orderItemId,
          listingId,
          reservedStems: 75,
          quantity: 3,
          unitPriceUsd: '312.50',
          productName: 'Pink Mondial',
        }])
        .mockReturnValueOnce(db);
      db.for
        .mockResolvedValueOnce([{ id: cartId, checkoutClaimedAt: new Date() }])
        .mockResolvedValueOnce([pendingOrder])
        .mockResolvedValueOnce([{ id: listingId, availableStems: 2425 }]);

      await expect(service.createOrder(userId, createOrderInput)).rejects.toMatchObject({
        code: 'PAYMENT_CREATION_FAILED',
      });

      expect(outbox.enqueueOrderEvent).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          eventType: 'order.cancelled',
          source: 'customer',
          order: pendingOrder,
          payment: { status: 'pending', provider: 'arcopay', paidAt: null },
        }),
      );
    });

    it('labels synthetic checkout compensation as a scenario event', async () => {
      const scenarioRunId = '00000000-0000-4000-8000-000000000060';
      const pendingOrder = {
        ...insertedOrder,
        status: 'pending' as const,
        synthetic: true,
        scenarioRunId,
      };
      const outbox = createOutboxMock();
      service = new OrdersService(db, fx, paymentProvider, testConfig, outbox);
      paymentProvider.createPayment.mockRejectedValueOnce(new Error('ArcPay unavailable'));
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([validCart]);
      mockCartItemsAndListingLocks([cartItemJoined]);
      db.returning
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([pendingOrder])
        .mockResolvedValueOnce([insertedOrderItem]);
      db.where
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          id: orderItemId,
          listingId,
          reservedStems: 75,
          quantity: 3,
          unitPriceUsd: '312.50',
          productName: 'Pink Mondial',
        }])
        .mockReturnValueOnce(db);
      db.for
        .mockResolvedValueOnce([{ id: cartId, checkoutClaimedAt: new Date() }])
        .mockResolvedValueOnce([pendingOrder])
        .mockResolvedValueOnce([{ id: listingId, availableStems: 2425 }]);

      await expect(service.createSyntheticCheckoutPaymentReached({
        userId,
        scenarioRunId,
        request: createOrderInput,
      })).rejects.toMatchObject({ code: 'PAYMENT_CREATION_FAILED' });

      expect(outbox.enqueueOrderEvent).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          eventType: 'order.cancelled',
          source: 'scenario',
          order: pendingOrder,
        }),
      );
    });

    it('rolls back compensation when a reserved listing is missing', async () => {
      const pendingOrder = { ...insertedOrder, status: 'pending' as const };
      paymentProvider.createPayment.mockRejectedValueOnce(new Error('ArcPay unavailable'));
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([validCart]);
      mockCartItemsAndListingLocks([cartItemJoined]);
      db.returning
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([pendingOrder])
        .mockResolvedValueOnce([insertedOrderItem]);
      db.where.mockReturnValueOnce(db);
      db.where.mockReturnValueOnce(db);
      db.where.mockReturnValueOnce(db);
      db.where.mockResolvedValueOnce([]);
      db.where.mockResolvedValueOnce([{
        listingId,
        reservedStems: 75,
      }]);
      db.where.mockReturnValueOnce(db);
      db.for.mockResolvedValueOnce([{
        id: cartId,
        checkoutClaimedAt: new Date(),
      }]);
      db.for.mockResolvedValueOnce([pendingOrder]);
      db.for.mockResolvedValueOnce([]);

      await expect(service.createOrder(userId, createOrderInput)).rejects.toMatchObject({
        code: 'ORDER_COMPENSATION_INVARIANT',
      });

      expect(db.set).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
      expect(db.set).not.toHaveBeenCalledWith({
        checkoutMerchantOrderId: null,
        checkoutClaimedAt: null,
      });
    });

    it('rejects a late provider response after a newer checkout replaces the claim', async () => {
      let resolvePayment!: (value: { externalId: string; paymentUrl: string }) => void;
      paymentProvider.createPayment.mockReturnValueOnce(new Promise((resolve) => {
        resolvePayment = resolve;
      }));
      const pendingOrder = { ...insertedOrder, status: 'pending' as const };
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([validCart]);
      mockCartItemsAndListingLocks([cartItemJoined]);
      db.returning
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([pendingOrder])
        .mockResolvedValueOnce([insertedOrderItem]);

      const checkoutPromise = service.createOrder(userId, createOrderInput);
      await vi.waitFor(() => {
        expect(paymentProvider.createPayment).toHaveBeenCalledOnce();
      });

      db.for
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          ...validCart,
          checkoutMerchantOrderId: 'FL-20260713-NEWER',
          checkoutClaimedAt: new Date(),
        }])
        .mockResolvedValueOnce([{ ...pendingOrder, status: 'cancelled' as const }]);

      resolvePayment({
        externalId: 'arcopay-late-order-1',
        paymentUrl: 'https://qr.nspk.ru/late-order-1',
      });

      await expect(checkoutPromise).rejects.toMatchObject({
        code: 'PAYMENT_CREATION_FAILED',
      });
      expect(db.insert).not.toHaveBeenCalledWith(payments);
      expect(db.delete).not.toHaveBeenCalled();
      expect(db.set).not.toHaveBeenCalledWith({
        checkoutMerchantOrderId: null,
        checkoutClaimedAt: null,
      });
    });

    it('rejects provider success after the matching checkout claim expires', async () => {
      const expiredClaimedAt = new Date(Date.now() - 16 * 60 * 1000);
      const pendingOrder = { ...insertedOrder, status: 'pending' as const };
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([validCart]);
      mockCartItemsAndListingLocks([cartItemJoined]);
      db.returning
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([pendingOrder])
        .mockResolvedValueOnce([insertedOrderItem]);
      db.where
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          listingId,
          reservedStems: 75,
        }])
        .mockReturnValueOnce(db);
      db.for
        .mockResolvedValueOnce([{
          id: cartId,
          checkoutClaimedAt: expiredClaimedAt,
        }])
        .mockResolvedValueOnce([{
          id: cartId,
          checkoutClaimedAt: expiredClaimedAt,
        }])
        .mockResolvedValueOnce([pendingOrder])
        .mockResolvedValueOnce([{
          id: listingId,
          availableStems: 2425,
        }]);

      await expect(service.createOrder(userId, createOrderInput)).rejects.toMatchObject({
        code: 'PAYMENT_CREATION_FAILED',
      });

      expect(db.insert).not.toHaveBeenCalledWith(payments);
      expect(db.delete).not.toHaveBeenCalled();
    });

    it('throws EmptyCartError when cart has no items', async () => {
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([validCart]);
      db.where.mockReturnValueOnce(db);
      db.where.mockReturnValueOnce(db);
      db.where.mockReturnValueOnce(db);
      db.where.mockReturnValueOnce(db);
      db.where.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([{ id: cartId }]);
      db.for.mockResolvedValueOnce([validCart]);

      await expect(
        service.createOrder(userId, createOrderInput),
      ).rejects.toThrow('Cannot create order from empty cart');
    });

    it('throws CartExpiredError when cart is expired', async () => {
      mockUserLookup('legal_entity');
      const expiredCart = { ...validCart, expiresAt: new Date(Date.now() - 1000) };
      db.limit.mockResolvedValueOnce([expiredCart]);
      db.for.mockResolvedValueOnce([expiredCart]);

      await expect(
        service.createOrder(userId, createOrderInput),
      ).rejects.toThrow('Cart has expired');
    });

    it('commits stale checkout recovery before rejecting the expired cart', async () => {
      const merchantOrderId = 'FL-20260713-EXPIRED';
      const expiredClaimedCart = {
        ...validCart,
        expiresAt: new Date(Date.now() - 1000),
        checkoutMerchantOrderId: merchantOrderId,
        checkoutClaimedAt: new Date(Date.now() - 16 * 60 * 1000),
      };
      let recoveryCommitted = false;
      db.transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
        const result = await fn(db);
        recoveryCommitted = true;
        return result;
      });
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([expiredClaimedCart]);
      db.where
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockReturnValueOnce(db)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ listingId, reservedStems: 75 }])
        .mockReturnValueOnce(db);
      db.for
        .mockResolvedValueOnce([expiredClaimedCart])
        .mockResolvedValueOnce([{
          id: orderId,
          status: 'pending' as const,
          merchantOrderId,
        }])
        .mockResolvedValueOnce([{ id: listingId, availableStems: 2425 }]);

      await expect(
        service.createOrder(userId, createOrderInput),
      ).rejects.toMatchObject({ code: 'CART_EXPIRED' });

      expect(recoveryCommitted).toBe(true);
      expect(db.set).toHaveBeenCalledWith({ availableStems: 2500 });
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({
        status: 'cancelled',
      }));
      expect(db.set).toHaveBeenCalledWith({
        checkoutMerchantOrderId: null,
        checkoutClaimedAt: null,
      });
      expect(paymentProvider.createPayment).not.toHaveBeenCalled();
    });

    it('throws ListingUnavailableError when listing is inactive', async () => {
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([validCart]);
      mockCartItemsAndListingLocks([{ ...cartItemJoined, isActive: false }]);

      await expect(
        service.createOrder(userId, createOrderInput),
      ).rejects.toThrow('Listing is no longer available');
    });

    it('throws InsufficientStemsError when available_stems < requested', async () => {
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([validCart]);
      mockCartItemsAndListingLocks([
        // availableStems=25 < requestedStems=5×25=125
        { ...cartItemJoined, availableStems: 25, quantity: 5 }, // DB column
      ]);

      await expect(
        service.createOrder(userId, createOrderInput),
      ).rejects.toMatchObject({
        code: 'INSUFFICIENT_STEMS',
        details: { listingId, available: 25, requested: 125 },
      });
    });

    it('snapshots listing price into order_items (not live-read)', async () => {
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([validCart]);
      mockCartItemsAndListingLocks([cartItemJoined]);
      mockPaymentPersistence();
      db.returning.mockResolvedValueOnce([]); // stock update
      db.returning.mockResolvedValueOnce([insertedOrder]);
      db.returning.mockResolvedValueOnce([insertedOrderItem]);

      await service.createOrder(userId, createOrderInput);

      // Verify order_items insert was called with the listing price as snapshot
      const valuesCalls = vi.mocked(db.values).mock.calls;
      // Find the call with order_items values (array with unitPriceUsd field)
      const orderItemsCall = valuesCalls.find((call) => {
        const value = call[0];
        if (Array.isArray(value)) {
          return (value[0] as Record<string, unknown>)?.unitPriceUsd !== undefined;
        }
        return false;
      });
      expect(orderItemsCall).toBeDefined();
      const values = orderItemsCall![0] as Array<{
        unitPriceUsd: string;
        totalPriceUsd: string;
        reservedStems: number;
      }>;
      // B2B: unit_price = wholesale × box_quantity = 12.50 × 25 = 312.50
      // total_price = unit_price × quantity = 312.50 × 3 = 937.50
      expect(values[0]!.unitPriceUsd).toBe('312.50');
      expect(values[0]!.totalPriceUsd).toBe('937.50');
      expect(values[0]!.reservedStems).toBe(75);
    });

    it('aggregates duplicate cart rows for one listing before reserving stock', async () => {
      const duplicateRow = {
        ...cartItemJoined,
        cartItemId: '00000000-0000-0000-0000-000000001001',
        quantity: 2,
      };
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([validCart]);
      mockCartItemsAndListingLocks([cartItemJoined, duplicateRow]);
      mockPaymentPersistence();
      db.returning.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([{
        ...insertedOrder,
        subtotalUsd: '1562.50',
        commissionUsd: '187.50',
        totalUsd: '1750.00',
      }]);
      db.returning.mockResolvedValueOnce([{
        ...insertedOrderItem,
        quantity: 5,
        totalPriceUsd: '1562.50',
      }]);

      await service.createOrder(userId, createOrderInput);

      const stockUpdates = vi.mocked(db.set).mock.calls.filter((call) => {
        const value = call[0] as Record<string, unknown>;
        return typeof value?.availableStems === 'number';
      });
      expect(stockUpdates).toHaveLength(1);
      expect(stockUpdates[0]![0]).toMatchObject({ availableStems: 2375 });

      const valuesCalls = vi.mocked(db.values).mock.calls;
      const orderItemsCall = valuesCalls.find((call) => {
        const value = call[0];
        return Array.isArray(value) && (value[0] as Record<string, unknown>)?.unitPriceUsd !== undefined;
      });
      expect(orderItemsCall).toBeDefined();
      const items = orderItemsCall![0] as Array<{
        quantity: number;
        reservedStems: number;
        totalPriceUsd: string;
      }>;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        quantity: 5,
        reservedStems: 125,
        totalPriceUsd: '1562.50',
      });
    });
  });

  describe('listOrders', () => {
    it('returns paginated orders for user', async () => {
      const orderRow = {
        id: '00000000-0000-0000-0000-000000000040',
        status: 'pending' as const,
        totalUsd: '42.00',
        displayCurrency: 'RUB' as const,
        createdAt: new Date('2026-04-10T10:00:00Z'),
      };
      db.offset.mockResolvedValueOnce([orderRow]);
      db.where.mockResolvedValueOnce([{ count: 1 }]);

      const result = await service.listOrders(userId, 1, 20);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.id).toBe(orderRow.id);
      expect(result.meta).toEqual({ total: 1, page: 1, limit: 20, pages: 1 });
    });

    it('returns empty list when user has no orders', async () => {
      db.offset.mockResolvedValueOnce([]);
      db.where.mockResolvedValueOnce([{ count: 0 }]);

      const result = await service.listOrders(userId, 1, 20);

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });
  });

  describe('createOrder — segment math', () => {
    const cartId = '00000000-0000-0000-0000-000000000100';
    const listingId = '00000000-0000-0000-0000-000000000010';
    const sellerId = '00000000-0000-0000-0000-000000000020';
    const orderId = '00000000-0000-0000-0000-000000000040';
    const orderItemId = '00000000-0000-0000-0000-000000000050';

    const validCart = {
      id: cartId,
      userId,
      checkoutMerchantOrderId: null,
      checkoutClaimedAt: null,
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      createdAt: new Date(),
    };

    const shippingAddress = {
      address: '1 Test St',
      contactName: 'Test User',
      contactPhone: '+1-000-000-0000',
    };

    /** Build a cart item joined row for the given listing fixture. */
    function makeCartItem(overrides: {
      sellerPriceUsd: string;
      boxQuantity: number;
      availableStems: number;
      quantity: number;
    }) {
      return {
        cartItemId: '00000000-0000-0000-0000-000000001000',
        quantity: overrides.quantity,
        listingId,
        sellerId,
        sellerPriceUsd: overrides.sellerPriceUsd,
        amsPriceUsd: '1.00',
        boxQuantity: overrides.boxQuantity,
        deliveryDate: '2026-04-20',
        isActive: true,
        availableStems: overrides.availableStems,
        productName: { en: 'Test Rose', ru: 'Тестовая Роза' },
      };
    }

    function mockCartItemsAndListingLocks(rows: ReturnType<typeof makeCartItem>[]) {
      db.where.mockReturnValueOnce(db);
      db.where.mockReturnValueOnce(db);
      db.where.mockReturnValueOnce(db);
      db.where.mockReturnValueOnce(db);
      db.where.mockResolvedValueOnce(rows);
      db.returning.mockResolvedValueOnce([{ id: cartId }]);
      db.for.mockResolvedValueOnce([validCart]);
      const rowsByListingId = new Map(rows.map((row) => [row.listingId, row]));
      for (const row of [...rowsByListingId.values()].sort((left, right) => (
        left.listingId.localeCompare(right.listingId)
      ))) {
        db.where.mockReturnValueOnce(db);
        db.for.mockResolvedValueOnce([{
          listingId: row.listingId,
          sellerId: row.sellerId,
          sellerPriceUsd: row.sellerPriceUsd,
          amsPriceUsd: row.amsPriceUsd,
          boxQuantity: row.boxQuantity,
          deliveryDate: row.deliveryDate,
          isActive: row.isActive,
          availableStems: row.availableStems,
        }]);
      }
    }

    /** Wire up the standard happy-path mocks after cart items and listing locks. */
    function mockHappyPath(subtotalUsd: string, commissionUsd: string, totalUsd: string, unitPriceUsd: string, totalPriceUsd: string) {
      // stock decrement returning
      db.returning.mockResolvedValueOnce([]);
      // insert order returning
      db.returning.mockResolvedValueOnce([{
        id: orderId,
        buyerId: userId,
        status: 'pending' as const,
        subtotalUsd,
        commissionUsd,
        totalUsd,
        deliveryFeeUsd: '0.00',
        estimatedDeliveryWeightKg: 0,
        estimatedDeliveryStems: 0,
        deliveryCountryCode: null,
        deliveryCityValue: null,
        displayCurrency: 'RUB' as const,
        shippingAddress,
        notes: null,
        merchantOrderId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }]);
      // insert order_items returning
      db.returning.mockResolvedValueOnce([{
        id: orderItemId,
        orderId,
        listingId,
        sellerId,
        quantity: 2,
        unitPriceUsd,
        totalPriceUsd,
        deliveryDate: '2026-04-20',
      }]);
      db.for
        .mockResolvedValueOnce([{ id: cartId, checkoutClaimedAt: new Date() }])
        .mockResolvedValueOnce([{ id: orderId }]);
    }

    it('B2B: decrements stems by quantity × box_quantity, snapshots unit price as wholesale × box_quantity', async () => {
      // wholesale=0.85, box_quantity=200, available_stems=2000, quantity=2
      // stemsToRemove = 2 × 200 = 400
      // unit_price_usd = 0.85 × 200 = 170.00
      // total_price_usd = 170.00 × 2 = 340.00
      // subtotal = 340.00, commission = 40.80, total = 380.80
      const cartItem = makeCartItem({ sellerPriceUsd: '0.85', boxQuantity: 200, availableStems: 2000, quantity: 2 });

      service = new OrdersService(db, createFxMock(2), paymentProvider, testConfig);
      mockUserLookup('legal_entity');
      db.limit.mockResolvedValueOnce([validCart]);
      mockCartItemsAndListingLocks([cartItem]);
      mockHappyPath('340.00', '40.80', '380.80', '170.00', '340.00');

      await service.createOrder(userId, {
        shippingAddress,
        segment: 'b2b',
        displayCurrency: 'RUB',
        delivery: {
          countryCode: 'RU',
          cityValue: 'Moscow',
        },
      });

      // Check the values passed to db.insert(orderItems)
      const valuesCalls = vi.mocked(db.values).mock.calls;
      const orderItemsCall = valuesCalls.find((call) => {
        const value = call[0];
        return Array.isArray(value) && (value[0] as Record<string, unknown>)?.unitPriceUsd !== undefined;
      });
      expect(orderItemsCall).toBeDefined();
      const items = orderItemsCall![0] as Array<{ unitPriceUsd: string; totalPriceUsd: string; reservedStems: number }>;
      expect(items[0]!.unitPriceUsd).toBe('170.00');  // 0.85 × 200
      expect(items[0]!.totalPriceUsd).toBe('340.00'); // 170.00 × 2
      expect(items[0]!.reservedStems).toBe(400);

      // Check stock decrement used stemsToRemove = 400
      const setCalls = vi.mocked(db.set).mock.calls;
      const stockUpdate = setCalls.find((call) => {
        const v = call[0] as Record<string, unknown>;
        return typeof v?.availableStems === 'number';
      });
      expect(stockUpdate).toBeDefined();
      const updated = (stockUpdate![0] as Record<string, number>).availableStems;
      expect(updated).toBe(2000 - 400); // 1600
    });

    it('B2C: decrements stems by quantity, snapshots unit price as wholesale × markup', async () => {
      // wholesale=0.85, box_quantity=200, available_stems=2000, markup=2, quantity=15
      // stemsToRemove = 15
      // unit_price_usd = 0.85 × 2 = 1.70
      // total_price_usd = 1.70 × 15 = 25.50
      // subtotal = 25.50, commission = 3.06, total = 28.56
      const cartItem = makeCartItem({ sellerPriceUsd: '0.85', boxQuantity: 200, availableStems: 2000, quantity: 15 });

      service = new OrdersService(db, createFxMock(2), paymentProvider, testConfig);
      mockUserLookup('individual');
      db.limit.mockResolvedValueOnce([validCart]);
      mockCartItemsAndListingLocks([cartItem]);
      mockHappyPath('25.50', '3.06', '28.56', '1.70', '25.50');

      await service.createOrder(individualUserId, {
        shippingAddress,
        segment: 'b2c',
        displayCurrency: 'RUB',
      });

      // Check the values passed to db.insert(orderItems)
      const valuesCalls = vi.mocked(db.values).mock.calls;
      const orderItemsCall = valuesCalls.find((call) => {
        const value = call[0];
        return Array.isArray(value) && (value[0] as Record<string, unknown>)?.unitPriceUsd !== undefined;
      });
      expect(orderItemsCall).toBeDefined();
      const items = orderItemsCall![0] as Array<{ unitPriceUsd: string; totalPriceUsd: string; reservedStems: number }>;
      expect(items[0]!.unitPriceUsd).toBe('1.70');   // 0.85 × 2
      expect(items[0]!.totalPriceUsd).toBe('25.50'); // 1.70 × 15
      expect(items[0]!.reservedStems).toBe(15);

      // Check stock decrement used stemsToRemove = 15 (not 15 × 200)
      const setCalls = vi.mocked(db.set).mock.calls;
      const stockUpdate = setCalls.find((call) => {
        const v = call[0] as Record<string, unknown>;
        return typeof v?.availableStems === 'number';
      });
      expect(stockUpdate).toBeDefined();
      const updated = (stockUpdate![0] as Record<string, number>).availableStems;
      expect(updated).toBe(2000 - 15); // 1985
    });

    it('B2C: insufficient stems triggers INSUFFICIENT_STEMS (quantity only, not × box_quantity)', async () => {
      // available_stems=10, quantity=50, segment=b2c → stemsToRemove=50 > 10 → 409
      const cartItem = makeCartItem({ sellerPriceUsd: '0.85', boxQuantity: 200, availableStems: 10, quantity: 50 });

      service = new OrdersService(db, createFxMock(2), paymentProvider, testConfig);
      mockUserLookup('individual');
      db.limit.mockResolvedValueOnce([validCart]);
      mockCartItemsAndListingLocks([cartItem]);

      await expect(
        service.createOrder(individualUserId, {
          shippingAddress,
          segment: 'b2c',
          displayCurrency: 'RUB',
        }),
      ).rejects.toMatchObject({
        code: 'INSUFFICIENT_STEMS',
        details: { listingId, available: 10, requested: 50 },
      });
    });
  });

  describe('getOrderById', () => {
    const orderId = '00000000-0000-0000-0000-000000000040';

    it('returns order with items for owning user', async () => {
      const orderRow = {
        id: orderId,
        buyerId: userId,
        status: 'pending' as const,
          subtotalUsd: '37.50',
          commissionUsd: '4.50',
          deliveryFeeUsd: '0.00',
          estimatedDeliveryWeightKg: 0,
          estimatedDeliveryStems: 0,
          deliveryCountryCode: null,
          deliveryCityValue: null,
          totalUsd: '42.00',
        displayCurrency: 'RUB' as const,
        shippingAddress: {
          address: '123 Flower Ave',
          contactName: 'John',
          contactPhone: '+1',
        },
        notes: null,
        merchantOrderId: 'FL-20260410-A1B2C3D4',
        createdAt: new Date('2026-04-10T10:00:00Z'),
        updatedAt: new Date('2026-04-10T10:00:00Z'),
      };
      const itemRow = {
        id: '00000000-0000-0000-0000-000000000050',
        orderId,
        listingId: '00000000-0000-0000-0000-000000000010',
        sellerId: '00000000-0000-0000-0000-000000000020',
        quantity: 3, // DB column
        unitPriceUsd: '12.50',
        totalPriceUsd: '37.50',
        deliveryDate: '2026-04-20',
      };
      db.limit.mockResolvedValueOnce([orderRow]);
      db.where.mockResolvedValueOnce([itemRow]);

      const result = await service.getOrderById(userId, orderId);

      expect(result.id).toBe(orderId);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.unitPriceUsd).toBe('12.50');
    });

    it('throws OrderNotFoundError for order of another user', async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(service.getOrderById(userId, orderId)).rejects.toThrow(
        'Order not found',
      );
    });
  });

});
