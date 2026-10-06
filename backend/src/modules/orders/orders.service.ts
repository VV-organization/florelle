import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import type { Database } from '../../shared/db/client';
import type { FxService } from '../../shared/currency/fx.service';
import type { PaymentProvider } from '../payments/payment-provider';
import type {
  AddCartItemBody,
  UpdateCartItemBody,
  CreateOrderBody,
  CartItemResponse,
  CartResponse,
  OrderDetail,
  OrderSummary,
  CreateOrderResponse,
} from './orders.schema';
import { listings } from '../../shared/db/schema/listings';
import { carts, cartItems } from '../../shared/db/schema/carts';
import { products } from '../../shared/db/schema/products';
import { sellers } from '../../shared/db/schema/sellers';
import { orders, orderItems } from '../../shared/db/schema/orders';
import { payments } from '../../shared/db/schema/payments';
import { users } from '../../shared/db/schema/users';
import {
  CartNotFoundError,
  CartExpiredError,
  CartItemNotFoundError,
  CheckoutClaimInvariantError,
  CheckoutInProgressError,
  EmptyCartError,
  ItemAlreadyInCartError,
  InsufficientStemsError,
  ListingUnavailableError,
  OrderNotFoundError,
  OrderCompensationInvariantError,
  PaymentCreationFailedError,
  SegmentMismatchError,
  InvalidDeliverySelectionError,
} from './orders.errors';
import { resolveField } from '../../shared/i18n/resolve-locale';
import type { Locale } from '../../shared/db/schema/types';
import { AppError, NotFoundError } from '../../shared/middleware/error.middleware';
import {
  expectedCustomerTypeForSegment,
  mapCustomerTypeToSegment,
  type Segment,
} from '../../shared/segment/segment';
import { addMoney } from '../../shared/money/money';
import { estimateB2bDelivery } from './delivery-estimate';

export type OrdersServiceConfig = {
  commissionPercent: number;
  cartTtlHours: number;
  callbackUrl: string;
  successUrl: string;
  failUrl: string;
};

export const CHECKOUT_CLAIM_LEASE_MS = 15 * 60 * 1000;

type OrdersTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type OrdersIntegrationOrder = Pick<
  typeof orders.$inferSelect,
  'id' | 'merchantOrderId' | 'totalUsd' | 'createdAt' | 'synthetic'
>;
type OrdersIntegrationOrderItem = Pick<
  typeof orderItems.$inferSelect,
  'id' | 'listingId' | 'quantity' | 'unitPriceUsd' | 'productName'
>;
export type OrdersIntegrationOutbox = {
  enqueueOrderEvent: (
    tx: OrdersTransaction,
    input: {
      eventType: 'order.created' | 'order.payment_reached' | 'order.cancelled';
      source: string;
      order: OrdersIntegrationOrder;
      items: OrdersIntegrationOrderItem[];
      payment: { status: string; provider: string; paidAt: Date | null };
    },
  ) => Promise<unknown>;
};
type CheckoutClaim = {
  id: string;
  checkoutMerchantOrderId: string | null;
  checkoutClaimedAt: Date | null;
};

type CheckoutOrderMetadata = {
  synthetic: boolean;
  scenarioRunId: string | null;
  eventSource: 'customer' | 'scenario';
};

export type CheckoutClaimRecoveryResult = {
  recoveredClaims: number;
  failedClaims: Array<{
    cartId: string;
    merchantOrderId: string | null;
    errorCode: string;
  }>;
};

export class OrdersService {
  constructor(
    private readonly db: Database,
    private readonly fxService: FxService,
    private readonly paymentProvider: PaymentProvider,
    private readonly config: OrdersServiceConfig,
    private readonly integrationOutbox?: OrdersIntegrationOutbox,
  ) {}

  private async assertSegmentMatchesUser(
    userId: string,
    segment: Segment,
  ): Promise<void> {
    const rows = await this.db
      .select({ customerType: users.customerType })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const user = rows[0];
    if (!user) {
      throw new NotFoundError('User not found');
    }
    if (user.customerType !== expectedCustomerTypeForSegment(segment)) {
      throw new SegmentMismatchError();
    }
  }

  async addCartItem(
    userId: string,
    input: AddCartItemBody,
  ): Promise<CartItemResponse> {
    await this.assertSegmentMatchesUser(userId, input.segment);

    // 1. Verify listing exists and is active
    const listingRows = await this.db
      .select({ id: listings.id, isActive: listings.isActive })
      .from(listings)
      .where(eq(listings.id, input.listingId))
      .limit(1);

    const listing = listingRows[0];
    if (!listing || !listing.isActive) {
      throw new ListingUnavailableError(input.listingId);
    }

    return this.db.transaction(async (tx) => {
      const cartRows = await tx
        .select()
        .from(carts)
        .where(eq(carts.userId, userId))
        .for('update');

      let cart = cartRows[0];
      if (cart) {
        await this.reconcileStaleClaimOrReject(tx, cart);
      }
      if (cart && cart.expiresAt.getTime() <= Date.now()) {
        await tx.delete(carts).where(eq(carts.id, cart.id));
        cart = undefined;
      }
      if (!cart) {
        const expiresAt = new Date(
          Date.now() + this.config.cartTtlHours * 60 * 60 * 1000,
        );
        const insertedCarts = await tx
          .insert(carts)
          .values({ userId, expiresAt })
          .returning();
        cart = insertedCarts[0]!;
      }

      const existingRows = await tx
        .select({ id: cartItems.id })
        .from(cartItems)
        .where(
          and(
            eq(cartItems.cartId, cart.id),
            eq(cartItems.listingId, input.listingId),
          ),
        )
        .limit(1);

      if (existingRows.length > 0) {
        throw new ItemAlreadyInCartError();
      }

      const inserted = await tx
        .insert(cartItems)
        .values({
          cartId: cart.id,
          listingId: input.listingId,
          quantity: input.quantity,
        })
        .returning();

      const row = inserted[0]!;
      return {
        id: row.id,
        listingId: row.listingId,
        quantity: row.quantity,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async getCart(userId: string, currency: string, lang: string): Promise<CartResponse> {
    const locale = lang as Locale;
    // 1. Load cart, check expiry; load segment from user.customerType so totals
    // use the right unit (stems for B2C, boxes for B2B).
    const userRows = await this.db
      .select({ customerType: users.customerType })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const user = userRows[0];
    if (!user) throw new NotFoundError('User not found');
    const segment = mapCustomerTypeToSegment(user.customerType);

    const cartRows = await this.db
      .select()
      .from(carts)
      .where(eq(carts.userId, userId))
      .limit(1);

    const cart = cartRows[0];
    if (!cart) throw new CartNotFoundError();
    if (cart.expiresAt.getTime() <= Date.now()) {
      throw new CartExpiredError();
    }

    // 2. Load items with listing + product + seller info
    const itemRows = await this.db
      .select({
        cartItemId: cartItems.id,
        quantity: cartItems.quantity,
        listingId: listings.id,
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
        sellerId: sellers.id,
        sellerName: sellers.name,
        sellerCountry: sellers.country,
        sellerVerified: sellers.verified,
      })
      .from(cartItems)
      .innerJoin(listings, eq(cartItems.listingId, listings.id))
      .innerJoin(products, eq(listings.productId, products.id))
      .innerJoin(sellers, eq(listings.sellerId, sellers.id))
      .where(eq(cartItems.cartId, cart.id));

    // 3. Convert prices, compute line totals, subtotal, commission
    let subtotalUsd = 0;
    const items = await Promise.all(
      itemRows.map(async (row) => {
        const lineTotalUsd =
          segment === 'b2b'
            ? parseFloat(row.sellerPriceUsd) * row.boxQuantity * row.quantity
            : parseFloat(row.sellerPriceUsd) * this.fxService.markup * row.quantity;
        subtotalUsd += lineTotalUsd;

        const sellerPrice =
          segment === 'b2b'
            ? await this.fxService.convert(row.sellerPriceUsd, currency)
            : await this.fxService.convertRetail(row.sellerPriceUsd, currency);
        const amsPrice = await this.fxService.convert(row.amsPriceUsd, currency);
        const lineTotal = await this.fxService.convert(
          lineTotalUsd.toFixed(2),
          currency,
        );

        return {
          id: row.cartItemId,
          listing: {
            id: row.listingId,
            product: {
              id: row.productId,
              name: resolveField(row.productName as unknown as { en: string; ru: string }, locale)!,
              slug: row.productSlug,
              species: row.productSpecies,
              color: row.productColor,
              imageUrl: row.productImageUrl,
            },
            seller: {
              id: row.sellerId,
              name: resolveField(row.sellerName as unknown as { en: string; ru: string }, locale)!,
              country: row.sellerCountry,
              verified: row.sellerVerified,
            },
            sellerPrice,
            amsPrice,
            boxQuantity: row.boxQuantity,
            availableStock: Math.floor(row.availableStems / row.boxQuantity),
            deliveryDate: row.deliveryDate,
          },
          quantity: row.quantity,
          lineTotal,
        };
      }),
    );

    const commissionUsd = (subtotalUsd * this.config.commissionPercent) / 100;
    const totalUsd = subtotalUsd + commissionUsd;

    return {
      id: cart.id,
      expiresAt: cart.expiresAt.toISOString(),
      items,
      subtotal: await this.fxService.convert(subtotalUsd.toFixed(2), currency),
      commission: await this.fxService.convert(commissionUsd.toFixed(2), currency),
      total: await this.fxService.convert(totalUsd.toFixed(2), currency),
    };
  }

  async updateCartItem(
    userId: string,
    itemId: string,
    input: UpdateCartItemBody,
  ): Promise<CartItemResponse> {
    await this.assertSegmentMatchesUser(userId, input.segment);

    return this.db.transaction(async (tx) => {
      const ownership = await tx
        .select({
          id: cartItems.id,
          cartId: carts.id,
          checkoutMerchantOrderId: carts.checkoutMerchantOrderId,
          checkoutClaimedAt: carts.checkoutClaimedAt,
        })
        .from(cartItems)
        .innerJoin(carts, eq(cartItems.cartId, carts.id))
        .where(and(eq(cartItems.id, itemId), eq(carts.userId, userId)))
        .for('update', { of: carts });

      if (ownership.length === 0) {
        throw new CartItemNotFoundError();
      }
      await this.reconcileStaleClaimOrReject(tx, {
        id: ownership[0]!.cartId,
        checkoutMerchantOrderId: ownership[0]!.checkoutMerchantOrderId,
        checkoutClaimedAt: ownership[0]!.checkoutClaimedAt,
      });

      const updated = await tx
        .update(cartItems)
        .set({ quantity: input.quantity })
        .where(eq(cartItems.id, itemId))
        .returning();

      const row = updated[0]!;
      return {
        id: row.id,
        listingId: row.listingId,
        quantity: row.quantity,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async removeCartItem(userId: string, itemId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const ownership = await tx
        .select({
          id: cartItems.id,
          cartId: carts.id,
          checkoutMerchantOrderId: carts.checkoutMerchantOrderId,
          checkoutClaimedAt: carts.checkoutClaimedAt,
        })
        .from(cartItems)
        .innerJoin(carts, eq(cartItems.cartId, carts.id))
        .where(and(eq(cartItems.id, itemId), eq(carts.userId, userId)))
        .for('update', { of: carts });

      if (ownership.length === 0) {
        throw new CartItemNotFoundError();
      }
      await this.reconcileStaleClaimOrReject(tx, {
        id: ownership[0]!.cartId,
        checkoutMerchantOrderId: ownership[0]!.checkoutMerchantOrderId,
        checkoutClaimedAt: ownership[0]!.checkoutClaimedAt,
      });

      await tx.delete(cartItems).where(eq(cartItems.id, itemId));
    });
  }

  async createOrder(
    userId: string,
    input: CreateOrderBody,
  ): Promise<CreateOrderResponse> {
    return this.createOrderWithMetadata(userId, input, {
      synthetic: false,
      scenarioRunId: null,
      eventSource: 'customer',
    });
  }

  async createSyntheticCheckoutPaymentReached(input: {
    userId: string;
    scenarioRunId: string;
    request: CreateOrderBody;
  }): Promise<CreateOrderResponse> {
    return this.createOrderWithMetadata(input.userId, input.request, {
      synthetic: true,
      scenarioRunId: input.scenarioRunId,
      eventSource: 'scenario',
    });
  }

  async cancelSyntheticCheckoutPaymentReached(input: {
    orderId: string;
    scenarioRunId: string;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const orderRows = await tx
        .select({
          id: orders.id,
          status: orders.status,
          merchantOrderId: orders.merchantOrderId,
          totalUsd: orders.totalUsd,
          createdAt: orders.createdAt,
          synthetic: orders.synthetic,
        })
        .from(orders)
        .where(and(
          eq(orders.id, input.orderId),
          eq(orders.synthetic, true),
          eq(orders.scenarioRunId, input.scenarioRunId),
        ))
        .for('update');
      const order = orderRows[0];
      if (!order || !order.merchantOrderId) {
        throw new Error('Synthetic scenario order is unavailable');
      }
      if (order.status === 'cancelled') return;
      if (order.status !== 'pending') {
        throw new Error('Synthetic scenario order is not pending');
      }

      const cartRows = await tx
        .select({ id: carts.id })
        .from(carts)
        .where(eq(carts.checkoutMerchantOrderId, order.merchantOrderId))
        .for('update');
      const cart = cartRows[0];
      if (!cart) throw new Error('Synthetic scenario cart is unavailable');

      const paymentRows = await tx
        .select({ id: payments.id, status: payments.status })
        .from(payments)
        .where(eq(payments.orderId, order.id))
        .for('update');
      if (paymentRows.some((payment) => payment.status === 'completed')) {
        throw new Error('Synthetic scenario payment is already completed');
      }
      if (paymentRows.some((payment) => payment.status === 'pending')) {
        await tx
          .update(payments)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(payments.orderId, order.id));
      }

      const items = await this.restorePendingOrderAndClearClaim(
        tx,
        cart.id,
        order.merchantOrderId,
        order.id,
      );
      await this.enqueueCancelledOrderEvent(tx, order, items);
    });
  }

  private async createOrderWithMetadata(
    userId: string,
    input: CreateOrderBody,
    metadata: CheckoutOrderMetadata,
  ): Promise<CreateOrderResponse> {
    await this.assertSegmentMatchesUser(userId, input.segment);

    // 1. Load cart, check expiry
    const cartRows = await this.db
      .select()
      .from(carts)
      .where(eq(carts.userId, userId))
      .limit(1);

    const cart = cartRows[0];
    if (!cart) throw new CartNotFoundError();

    const merchantOrderId = generateMerchantOrderId();

    // 2. Start transaction — all stock + order inserts atomic
    const checkout = await this.db.transaction(async (tx) => {
      const lockedCartRows = await tx
        .select()
        .from(carts)
        .where(eq(carts.id, cart.id))
        .for('update');
      const lockedCart = lockedCartRows[0];
      if (!lockedCart) throw new CartNotFoundError();

      await this.reconcileStaleClaimOrReject(tx, lockedCart);
      if (lockedCart.expiresAt.getTime() <= Date.now()) {
        return { expired: true as const };
      }

      const checkoutClaimedAt = new Date();
      const claimedCarts = await tx
        .update(carts)
        .set({
          checkoutMerchantOrderId: merchantOrderId,
          checkoutClaimedAt,
        })
        .where(eq(carts.id, cart.id))
        .returning({ id: carts.id });
      if (claimedCarts.length === 0) {
        throw new CheckoutClaimInvariantError(merchantOrderId, 'CLAIM_UPDATE_FAILED');
      }

      // Load cart items and product snapshots without locking listings. Listings
      // are locked below in deterministic listing-id order.
      const itemRows = await tx
        .select({
          cartItemId: cartItems.id,
          quantity: cartItems.quantity,
          listingId: cartItems.listingId,
          productName: products.name,
        })
        .from(cartItems)
        .innerJoin(listings, eq(cartItems.listingId, listings.id))
        .innerJoin(products, eq(listings.productId, products.id))
        .where(eq(cartItems.cartId, cart.id));

      if (itemRows.length === 0) {
        throw new EmptyCartError();
      }

      const segment = input.segment;
      const markup = this.fxService.markup;

      const aggregatedItemsByListingId = new Map<
        string,
        {
          listingId: string;
          quantity: number;
          productName: unknown;
        }
      >();
      for (const row of itemRows) {
        const existing = aggregatedItemsByListingId.get(row.listingId);
        if (existing) {
          existing.quantity += row.quantity;
        } else {
          aggregatedItemsByListingId.set(row.listingId, {
            listingId: row.listingId,
            quantity: row.quantity,
            productName: row.productName,
          });
        }
      }

      const lockedListings = new Map<
        string,
        {
          listingId: string;
          sellerId: string;
          sellerPriceUsd: string;
          amsPriceUsd: string;
          boxQuantity: number;
          deliveryDate: string;
          isActive: boolean;
          availableStems: number;
        }
      >();
      const listingIds = [...aggregatedItemsByListingId.keys()].sort();
      for (const listingId of listingIds) {
        const listingRows = await tx
          .select({
            listingId: listings.id,
            sellerId: listings.sellerId,
            sellerPriceUsd: listings.sellerPriceUsd,
            amsPriceUsd: listings.amsPriceUsd,
            boxQuantity: listings.boxQuantity,
            deliveryDate: listings.deliveryDate,
            isActive: listings.isActive,
            availableStems: listings.availableStems,
          })
          .from(listings)
          .where(eq(listings.id, listingId))
          .for('update');
        const listing = listingRows[0];
        if (!listing) {
          throw new ListingUnavailableError(listingId);
        }
        lockedListings.set(listingId, listing);
      }

      // Hoist stemsToRemove and unitPriceUsdNum per row (used in validation, decrement, and totals)
      const itemsWithStems = listingIds.map((listingId) => {
        const item = aggregatedItemsByListingId.get(listingId)!;
        const listing = lockedListings.get(listingId)!;
        const stemsToRemove = segment === 'b2b'
          ? item.quantity * listing.boxQuantity
          : item.quantity;
        const unitPriceUsdNum = segment === 'b2b'
          ? parseFloat(listing.sellerPriceUsd) * listing.boxQuantity
          : parseFloat(listing.sellerPriceUsd) * markup;
        return {
          ...listing,
          quantity: item.quantity,
          productName: item.productName,
          stemsToRemove,
          unitPriceUsdNum,
        };
      });

      // Validate all items
      for (const row of itemsWithStems) {
        if (!row.isActive) {
          throw new ListingUnavailableError(row.listingId);
        }
        if (row.availableStems < row.stemsToRemove) {
          throw new InsufficientStemsError(
            row.listingId,
            row.availableStems,
            row.stemsToRemove,
          );
        }
      }

      // Compute totals
      let subtotalUsdNum = 0;
      for (const row of itemsWithStems) {
        subtotalUsdNum += row.unitPriceUsdNum * row.quantity;
      }
      const commissionUsdNum =
        (subtotalUsdNum * this.config.commissionPercent) / 100;

      const subtotalUsd = subtotalUsdNum.toFixed(2);
      const commissionUsd = commissionUsdNum.toFixed(2);
      let deliveryFeeUsd = '0.00';
      let estimatedDeliveryWeightKg = 0;
      let estimatedDeliveryStems = 0;
      let deliveryCountryCode: 'RU' | 'KZ' | 'TR' | null = null;
      let deliveryCityValue: string | null = null;

      if (segment === 'b2b') {
        if (!input.delivery) {
          throw new InvalidDeliverySelectionError();
        }

        try {
          const deliveryEstimate = await estimateB2bDelivery({
            countryCode: input.delivery.countryCode,
            cityValue: input.delivery.cityValue,
            stemCount: itemsWithStems.reduce((sum, row) => sum + row.stemsToRemove, 0),
            getRate: (target) => this.fxService.getRate(target),
          });

          deliveryFeeUsd = deliveryEstimate.feeUsd;
          estimatedDeliveryWeightKg = deliveryEstimate.estimatedWeightKg;
          estimatedDeliveryStems = deliveryEstimate.estimatedStems;
          deliveryCountryCode = input.delivery.countryCode;
          deliveryCityValue = input.delivery.cityValue;
        } catch {
          throw new InvalidDeliverySelectionError(
            input.delivery.countryCode,
            input.delivery.cityValue,
          );
        }
      }

      const totalUsd = addMoney(addMoney(subtotalUsd, commissionUsd), deliveryFeeUsd);

      // Decrement stock for each listing
      for (const row of itemsWithStems) {
        await tx
          .update(listings)
          .set({
            availableStems: row.availableStems - row.stemsToRemove,
          })
          .where(eq(listings.id, row.listingId))
          .returning();
      }

      // Insert order
      const insertedOrders = await tx
        .insert(orders)
        .values({
          buyerId: userId,
          status: 'pending',
          subtotalUsd,
          commissionUsd,
          deliveryFeeUsd,
          estimatedDeliveryWeightKg,
          estimatedDeliveryStems,
          deliveryCountryCode,
          deliveryCityValue,
          totalUsd,
          displayCurrency: input.displayCurrency ?? 'TRY',
          shippingAddress: input.shippingAddress,
          notes: input.notes ?? null,
          merchantOrderId,
          synthetic: metadata.synthetic,
          scenarioRunId: metadata.scenarioRunId,
        })
        .returning();

      const order = insertedOrders[0]!;

      // Insert order_items (snapshots)
      const orderItemsToInsert = itemsWithStems.map((row) => {
        const unitPriceUsd = row.unitPriceUsdNum.toFixed(2);
        const totalPriceUsd = (row.unitPriceUsdNum * row.quantity).toFixed(2);
        // Snapshot name in English (stable for order records)
        const pName = row.productName as { en: string; ru: string };
        return {
          orderId: order.id,
          listingId: row.listingId,
          sellerId: row.sellerId,
          quantity: row.quantity, // DB column (from cart_items)
          reservedStems: row.stemsToRemove,
          unitPriceUsd,
          totalPriceUsd,
          deliveryDate: row.deliveryDate,
          productName: pName.en,
        };
      });

      const insertedItems = await tx
        .insert(orderItems)
        .values(orderItemsToInsert)
        .returning();

      await this.integrationOutbox?.enqueueOrderEvent(tx, {
        eventType: 'order.created',
        source: metadata.eventSource,
        order,
        items: insertedItems,
        payment: { status: 'pending', provider: 'arcopay', paidAt: null },
      });

      return { expired: false as const, order, items: insertedItems };
    });

    if (checkout.expired) {
      throw new CartExpiredError();
    }
    const { order, items } = checkout;

    try {
      const payment = await this.paymentProvider.createPayment({
        merchantOrderId,
        amountUsd: order.totalUsd,
        description: `Flowers order ${order.id}`,
        callbackUrl: this.config.callbackUrl,
        successUrl: this.config.successUrl.replace('{orderId}', order.id),
        failUrl: this.config.failUrl.replace('{orderId}', order.id),
      });
      const validatedPayment = validatePaymentCreationResult(payment);

      await this.db.transaction(async (tx) => {
        const claimedCartRows = await tx
          .select({
            id: carts.id,
            checkoutClaimedAt: carts.checkoutClaimedAt,
          })
          .from(carts)
          .where(
            and(
              eq(carts.id, cart.id),
              eq(carts.checkoutMerchantOrderId, merchantOrderId),
              isNotNull(carts.checkoutClaimedAt),
            ),
          )
          .for('update');
        if (claimedCartRows.length === 0) {
          throw new LostCheckoutClaimError();
        }
        const paymentPersistenceNow = Date.now();
        const checkoutClaimedAt = claimedCartRows[0]!.checkoutClaimedAt;
        if (
          !checkoutClaimedAt
          || paymentPersistenceNow - checkoutClaimedAt.getTime() >= CHECKOUT_CLAIM_LEASE_MS
        ) {
          throw new LostCheckoutClaimError();
        }

        const pendingOrderRows = await tx
          .select({ id: orders.id })
          .from(orders)
          .where(and(eq(orders.id, order.id), eq(orders.status, 'pending')))
          .for('update');
        if (pendingOrderRows.length === 0) {
          throw new LostCheckoutClaimError();
        }

        if (metadata.synthetic) {
          await tx
            .update(orders)
            .set({
              scenarioPaymentUrlHost: new URL(validatedPayment.paymentUrl).host,
            })
            .where(eq(orders.id, order.id));
        }

        await tx.insert(payments).values({
          orderId: order.id,
          provider: 'arcopay',
          externalId: validatedPayment.externalId,
          amountUsd: order.totalUsd,
          status: 'pending',
        });
        await this.integrationOutbox?.enqueueOrderEvent(tx, {
          eventType: 'order.payment_reached',
          source: metadata.eventSource,
          order,
          items,
          payment: { status: 'pending', provider: 'arcopay', paidAt: null },
        });
        if (!metadata.synthetic) {
          await tx
            .delete(carts)
            .where(
              and(
                eq(carts.id, cart.id),
                eq(carts.checkoutMerchantOrderId, merchantOrderId),
              ),
            );
        }
      });

      return {
        order: mapCreatedOrder(order, items),
        paymentUrl: validatedPayment.paymentUrl,
      };
    } catch {
      await this.cancelPendingOrderAndRestoreStock(
        order.id,
        cart.id,
        merchantOrderId,
      );
      throw new PaymentCreationFailedError();
    }
  }

  async recoverStaleCheckoutClaims(
    batchSize = 25,
  ): Promise<CheckoutClaimRecoveryResult> {
    const staleBefore = new Date(Date.now() - CHECKOUT_CLAIM_LEASE_MS);
    const candidates = await this.db
      .select({ id: carts.id })
      .from(carts)
      .where(
        and(
          isNotNull(carts.checkoutMerchantOrderId),
          isNotNull(carts.checkoutClaimedAt),
          lt(carts.checkoutClaimedAt, staleBefore),
        ),
      )
      .orderBy(carts.checkoutClaimedAt)
      .limit(batchSize);

    const result: CheckoutClaimRecoveryResult = {
      recoveredClaims: 0,
      failedClaims: [],
    };

    for (const candidate of candidates) {
      let lockedClaim: CheckoutClaim | undefined;
      try {
        const recovered = await this.db.transaction(async (tx) => {
          const claimRows = await tx
            .select({
              id: carts.id,
              checkoutMerchantOrderId: carts.checkoutMerchantOrderId,
              checkoutClaimedAt: carts.checkoutClaimedAt,
            })
            .from(carts)
            .where(
              and(
                eq(carts.id, candidate.id),
                isNotNull(carts.checkoutMerchantOrderId),
                isNotNull(carts.checkoutClaimedAt),
                lt(carts.checkoutClaimedAt, staleBefore),
              ),
            )
            .for('update', { skipLocked: true });
          lockedClaim = claimRows[0];
          if (!lockedClaim) return false;

          await this.reconcileStaleClaimOrReject(tx, lockedClaim);
          return true;
        });
        if (recovered) result.recoveredClaims += 1;
      } catch (error) {
        result.failedClaims.push({
          cartId: candidate.id,
          merchantOrderId: lockedClaim?.checkoutMerchantOrderId ?? null,
          errorCode: error instanceof AppError ? error.code : 'UNEXPECTED_ERROR',
        });
      }
    }

    return result;
  }

  private async cancelPendingOrderAndRestoreStock(
    orderId: string,
    cartId: string,
    merchantOrderId: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const matchingCartRows = await tx
        .select({
          id: carts.id,
          checkoutClaimedAt: carts.checkoutClaimedAt,
        })
        .from(carts)
        .where(
          and(
            eq(carts.id, cartId),
            eq(carts.checkoutMerchantOrderId, merchantOrderId),
          ),
        )
        .for('update');
      const matchingCart = matchingCartRows[0];

      if (!matchingCart) {
        const currentCartRows = await tx
          .select({ id: carts.id })
          .from(carts)
          .where(eq(carts.id, cartId))
          .for('update');
        if (currentCartRows.length === 0) {
          throw new CheckoutClaimInvariantError(merchantOrderId, 'CART_MISSING');
        }
      }

      const orderRows = await tx
        .select({
          id: orders.id,
          status: orders.status,
          merchantOrderId: orders.merchantOrderId,
          totalUsd: orders.totalUsd,
          createdAt: orders.createdAt,
          synthetic: orders.synthetic,
        })
        .from(orders)
        .where(eq(orders.id, orderId))
        .for('update');

      const order = orderRows[0];
      if (!order) {
        throw new CheckoutClaimInvariantError(merchantOrderId, 'ORDER_MISSING');
      }

      if (!matchingCart) {
        if (order.status === 'pending') {
          throw new CheckoutClaimInvariantError(
            merchantOrderId,
            'PENDING_ORDER_LOST_CART_CLAIM',
          );
        }
        return;
      }

      if (!matchingCart.checkoutClaimedAt) {
        throw new CheckoutClaimInvariantError(merchantOrderId, 'CLAIM_TIMESTAMP_MISSING');
      }

      if (order.status === 'cancelled') {
        await this.clearCartClaim(tx, cartId, merchantOrderId);
        return;
      }
      if (order.status !== 'pending') {
        throw new CheckoutClaimInvariantError(
          merchantOrderId,
          `UNSAFE_TERMINAL_ORDER_STATUS_${order.status.toUpperCase()}`,
        );
      }

      await this.assertPendingOrderHasNoCompletedPayment(tx, order.id, merchantOrderId);
      const items = await this.restorePendingOrderAndClearClaim(
        tx,
        cartId,
        merchantOrderId,
        order.id,
      );
      await this.enqueueCancelledOrderEvent(tx, order, items);
    });
  }

  private async reconcileStaleClaimOrReject(
    tx: OrdersTransaction,
    cart: CheckoutClaim,
  ): Promise<void> {
    const merchantOrderId = cart.checkoutMerchantOrderId;
    const claimedAt = cart.checkoutClaimedAt;
    if (!merchantOrderId && !claimedAt) return;
    if (!merchantOrderId || !claimedAt) {
      throw new CheckoutClaimInvariantError(
        merchantOrderId,
        'INCOMPLETE_CLAIM_METADATA',
      );
    }

    if (Date.now() - claimedAt.getTime() < CHECKOUT_CLAIM_LEASE_MS) {
      throw new CheckoutInProgressError();
    }

    const orderRows = await tx
      .select({
        id: orders.id,
        status: orders.status,
        merchantOrderId: orders.merchantOrderId,
        totalUsd: orders.totalUsd,
        createdAt: orders.createdAt,
        synthetic: orders.synthetic,
      })
      .from(orders)
      .where(eq(orders.merchantOrderId, merchantOrderId))
      .for('update');
    const order = orderRows[0];
    if (!order) {
      throw new CheckoutClaimInvariantError(merchantOrderId, 'ORDER_MISSING');
    }

    if (order.status === 'cancelled') {
      await this.clearCartClaim(tx, cart.id, merchantOrderId);
      return;
    }
    if (order.status !== 'pending') {
      throw new CheckoutClaimInvariantError(
        merchantOrderId,
        `UNSAFE_TERMINAL_ORDER_STATUS_${order.status.toUpperCase()}`,
      );
    }

    await this.assertPendingOrderHasNoCompletedPayment(tx, order.id, merchantOrderId);
    const items = await this.restorePendingOrderAndClearClaim(
      tx,
      cart.id,
      merchantOrderId,
      order.id,
    );
    await this.enqueueCancelledOrderEvent(tx, order, items);
  }

  private async enqueueCancelledOrderEvent(
    tx: OrdersTransaction,
    order: OrdersIntegrationOrder,
    items: OrdersIntegrationOrderItem[],
  ): Promise<void> {
    await this.integrationOutbox?.enqueueOrderEvent(tx, {
      eventType: 'order.cancelled',
      source: order.synthetic ? 'scenario' : 'customer',
      order,
      items,
      payment: { status: 'pending', provider: 'arcopay', paidAt: null },
    });
  }

  private async assertPendingOrderHasNoCompletedPayment(
    tx: OrdersTransaction,
    orderId: string,
    merchantOrderId: string,
  ): Promise<void> {
    const paymentRows = await tx
      .select({ id: payments.id, status: payments.status })
      .from(payments)
      .where(eq(payments.orderId, orderId));
    if (paymentRows.some((payment) => payment.status === 'completed')) {
      throw new CheckoutClaimInvariantError(
        merchantOrderId,
        'PENDING_ORDER_HAS_COMPLETED_PAYMENT',
      );
    }
  }

  private async restorePendingOrderAndClearClaim(
    tx: OrdersTransaction,
    cartId: string,
    merchantOrderId: string,
    orderId: string,
  ): Promise<OrdersIntegrationOrderItem[]> {
    const items = await tx
      .select({
        id: orderItems.id,
        orderId: orderItems.orderId,
        listingId: orderItems.listingId,
        sellerId: orderItems.sellerId,
        quantity: orderItems.quantity,
        reservedStems: orderItems.reservedStems,
        unitPriceUsd: orderItems.unitPriceUsd,
        totalPriceUsd: orderItems.totalPriceUsd,
        deliveryDate: orderItems.deliveryDate,
        productName: orderItems.productName,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    if (items.length === 0) {
      throw new CheckoutClaimInvariantError(merchantOrderId, 'ORDER_ITEMS_MISSING');
    }

    const reservedStemsByListingId = new Map<string, number>();
    for (const item of items) {
      reservedStemsByListingId.set(
        item.listingId,
        (reservedStemsByListingId.get(item.listingId) ?? 0) + item.reservedStems,
      );
    }

    const listingRestores = [...reservedStemsByListingId.entries()].sort(
      ([leftId], [rightId]) => leftId.localeCompare(rightId),
    );

    for (const [listingId, reservedStems] of listingRestores) {
      const listingRows = await tx
        .select({
          id: listings.id,
          availableStems: listings.availableStems,
        })
        .from(listings)
        .where(eq(listings.id, listingId))
        .for('update');
      const listing = listingRows[0];
      if (!listing) {
        throw new OrderCompensationInvariantError(listingId);
      }
      await tx
        .update(listings)
        .set({
          availableStems: listing.availableStems + reservedStems,
        })
        .where(eq(listings.id, listing.id));
    }

    await tx
      .update(orders)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(orders.id, orderId));
    await this.clearCartClaim(tx, cartId, merchantOrderId);
    return items;
  }

  private async clearCartClaim(
    tx: OrdersTransaction,
    cartId: string,
    merchantOrderId: string,
  ): Promise<void> {
    await tx
      .update(carts)
      .set({
        checkoutMerchantOrderId: null,
        checkoutClaimedAt: null,
      })
      .where(
        and(
          eq(carts.id, cartId),
          eq(carts.checkoutMerchantOrderId, merchantOrderId),
        ),
      );
  }

  async listOrders(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{ data: OrderSummary[]; meta: { total: number; page: number; limit: number; pages: number } }> {
    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.buyerId, userId));

    const total = countRows[0]?.count ?? 0;

    const rows = await this.db
      .select({
        id: orders.id,
        status: orders.status,
        totalUsd: orders.totalUsd,
        displayCurrency: orders.displayCurrency,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(eq(orders.buyerId, userId))
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return {
      data: rows.map((r) => ({
        id: r.id,
        status: r.status,
        totalUsd: r.totalUsd,
        displayCurrency: r.displayCurrency,
        createdAt: r.createdAt.toISOString(),
      })),
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getOrderById(userId: string, orderId: string): Promise<OrderDetail> {
    // Items are fetched first so that the mock's where terminal fires before
    // the order lookup's where+limit chain.
    const itemRows = await this.db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    const orderRows = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.buyerId, userId)))
      .limit(1);

    const order = orderRows[0];
    if (!order) throw new OrderNotFoundError();

    return {
      id: order.id,
      status: order.status,
      subtotalUsd: order.subtotalUsd,
      commissionUsd: order.commissionUsd,
      deliveryFeeUsd: order.deliveryFeeUsd,
      estimatedDeliveryWeightKg: order.estimatedDeliveryWeightKg,
      estimatedDeliveryStems: order.estimatedDeliveryStems,
      deliveryCountryCode: order.deliveryCountryCode as OrderDetail['deliveryCountryCode'],
      deliveryCityValue: order.deliveryCityValue,
      totalUsd: order.totalUsd,
      displayCurrency: order.displayCurrency,
      shippingAddress: order.shippingAddress as OrderDetail['shippingAddress'],
      notes: order.notes,
      items: itemRows.map((item) => ({
        id: item.id,
        listingId: item.listingId,
        sellerId: item.sellerId,
        quantity: item.quantity,
        unitPriceUsd: item.unitPriceUsd,
        totalPriceUsd: item.totalPriceUsd,
        deliveryDate: item.deliveryDate,
      })),
      createdAt: order.createdAt.toISOString(),
    };
  }
}

function mapCreatedOrder(
  order: typeof orders.$inferSelect,
  items: Array<typeof orderItems.$inferSelect>,
): OrderDetail {
  return {
    id: order.id,
    status: order.status,
    subtotalUsd: order.subtotalUsd,
    commissionUsd: order.commissionUsd,
    deliveryFeeUsd: order.deliveryFeeUsd,
    estimatedDeliveryWeightKg: order.estimatedDeliveryWeightKg,
    estimatedDeliveryStems: order.estimatedDeliveryStems,
    deliveryCountryCode: order.deliveryCountryCode as OrderDetail['deliveryCountryCode'],
    deliveryCityValue: order.deliveryCityValue,
    totalUsd: order.totalUsd,
    displayCurrency: order.displayCurrency,
    shippingAddress: order.shippingAddress as OrderDetail['shippingAddress'],
    notes: order.notes,
    items: items.map((item) => ({
      id: item.id,
      listingId: item.listingId,
      sellerId: item.sellerId,
      quantity: item.quantity,
      unitPriceUsd: item.unitPriceUsd,
      totalPriceUsd: item.totalPriceUsd,
      deliveryDate: item.deliveryDate,
    })),
    createdAt: order.createdAt.toISOString(),
  };
}

function validatePaymentCreationResult(payment: {
  externalId: string;
  paymentUrl: string;
}): { externalId: string; paymentUrl: string } {
  const externalId = payment.externalId.trim();
  if (!externalId) {
    throw new Error('Payment provider returned an empty external id');
  }

  const paymentUrl = new URL(payment.paymentUrl);
  if (
    paymentUrl.protocol !== 'https:'
    || paymentUrl.username
    || paymentUrl.password
  ) {
    throw new Error('Payment provider returned an unsafe payment URL');
  }

  return { externalId, paymentUrl: paymentUrl.toString() };
}

function generateMerchantOrderId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = randomUUID().slice(0, 8).toUpperCase();
  return `FL-${date}-${random}`;
}

class LostCheckoutClaimError extends Error {}
