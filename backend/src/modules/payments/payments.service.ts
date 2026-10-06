import { eq } from 'drizzle-orm';
import type { Database } from '../../shared/db/client';
import { orders, orderItems } from '../../shared/db/schema/orders';
import { payments } from '../../shared/db/schema/payments';
import { listings } from '../../shared/db/schema/listings';
import { users } from '../../shared/db/schema/users';
import { canTransition } from '../orders/orders.state-machine';
import type { NotificationsService, SendOrderPaidInput } from '../notifications/notifications.service';
import type { PaymentProvider, WebhookPayload } from './payment-provider';

type PaymentIntegrationTransaction = Pick<Database, 'insert' | 'select'>;
type PaymentIntegrationOrder = Pick<
  typeof orders.$inferSelect,
  'id' | 'merchantOrderId' | 'totalUsd' | 'createdAt' | 'synthetic'
>;
type PaymentIntegrationOrderItem = Pick<
  typeof orderItems.$inferSelect,
  'id' | 'listingId' | 'quantity' | 'unitPriceUsd' | 'productName'
>;

export type PaymentIntegrationOutbox = {
  enqueueOrderEvent: (
    tx: PaymentIntegrationTransaction,
    input: {
      eventType: 'order.paid' | 'order.cancelled';
      source: string;
      order: PaymentIntegrationOrder;
      items: PaymentIntegrationOrderItem[];
      payment: { status: string; provider: string; paidAt: Date | null };
    },
  ) => Promise<unknown>;
};

export class WebhookService {
  constructor(
    private readonly db: Database,
    private readonly paymentProvider: PaymentProvider,
    private readonly integrationOutbox?: PaymentIntegrationOutbox,
    private readonly notifications?: Pick<NotificationsService, 'sendOrderPaid'>,
  ) {}

  /**
   * Process an incoming webhook callback from the payment provider.
   *
   * Validation outcomes return handled results. Transactional failures
   * propagate to the router so it can return a retryable HTTP 503 response.
   */
  async handleCallback(
    rawBody: Buffer,
    signature: string,
    body: unknown,
  ): Promise<{ handled: boolean; reason?: string }> {
    // 1. Verify signature
    if (!this.paymentProvider.verifyWebhookSignature(rawBody, signature)) {
      return { handled: false, reason: 'invalid_signature' };
    }

    // 2. Parse payload
    let payload: WebhookPayload;
    try {
      payload = this.paymentProvider.parseWebhookPayload(body);
    } catch {
      return { handled: false, reason: 'parse_failed' };
    }

    // 3. Intermediate provider statuses are informational. They must not
    // cancel orders or restore stock.
    if (payload.status === 'pending') {
      return { handled: true, reason: 'payment_pending' };
    }

    const result = await this.db.transaction(async (tx) => {
      const paymentRows = await tx
        .select()
        .from(payments)
        .where(eq(payments.externalId, payload.externalId))
        .for('update');

      const payment = paymentRows[0];
      if (!payment) {
        return { handled: false, reason: 'payment_not_found' };
      }

      if (payment.status === 'completed' || payment.status === 'failed') {
        return { handled: true, reason: 'already_processed' };
      }

      const orderRows = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, payment.orderId))
        .for('update');

      const order = orderRows[0];
      if (!order) {
        return { handled: false, reason: 'order_not_found' };
      }
      if (order.merchantOrderId !== payload.merchantOrderId) {
        return { handled: false, reason: 'merchant_order_mismatch' };
      }

      const targetStatus = payload.status === 'paid' ? 'paid' : 'cancelled';
      if (!canTransition(order.status, targetStatus)) {
        return { handled: false, reason: 'invalid_transition' };
      }

      const transitionedAt = new Date();
      if (targetStatus === 'paid') {
        const items = await this.loadIntegrationItems(tx, order.id);
        await tx
          .update(orders)
          .set({ status: 'paid', updatedAt: transitionedAt })
          .where(eq(orders.id, order.id));
        await tx
          .update(payments)
          .set({ status: 'completed', updatedAt: transitionedAt })
          .where(eq(payments.id, payment.id));
        await this.integrationOutbox?.enqueueOrderEvent(tx, {
          eventType: 'order.paid',
          source: order.synthetic ? 'scenario' : 'customer',
          order,
          items,
          payment: {
            status: 'paid',
            provider: payment.provider,
            paidAt: transitionedAt,
          },
        });

        let orderPaidEmail: SendOrderPaidInput | undefined;
        if (this.notifications && !order.synthetic) {
          const userRows = await tx
            .select({ email: users.email })
            .from(users)
            .where(eq(users.id, order.buyerId))
            .limit(1);
          const user = userRows[0];
          if (user) {
            orderPaidEmail = {
              to: user.email,
              orderId: order.id,
              totalUsd: order.totalUsd,
              paidAt: transitionedAt,
              idempotencyKey: `order-paid/${order.id}`,
            };
          }
        }

        return { handled: true, orderPaidEmail };
      }

      const items = await tx
        .select({
          id: orderItems.id,
          listingId: orderItems.listingId,
          quantity: orderItems.quantity,
          reservedStems: orderItems.reservedStems,
          unitPriceUsd: orderItems.unitPriceUsd,
          productName: orderItems.productName,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id));

      const reservedStemsByListingId = new Map<string, number>();
      for (const item of items) {
        reservedStemsByListingId.set(
          item.listingId,
          (reservedStemsByListingId.get(item.listingId) ?? 0) +
            item.reservedStems,
        );
      }

      const listingRestores = [...reservedStemsByListingId.entries()].sort(
        ([leftId], [rightId]) => leftId.localeCompare(rightId),
      );

      const lockedListings: Array<{
        id: string;
        availableStems: number;
        reservedStems: number;
      }> = [];
      for (const [listingId, reservedStems] of listingRestores) {
        const listingRows = await tx
          .select({ id: listings.id, availableStems: listings.availableStems })
          .from(listings)
          .where(eq(listings.id, listingId))
          .for('update');
        const listing = listingRows[0];
        if (!listing) {
          return { handled: false, reason: 'listing_not_found' };
        }
        lockedListings.push({ ...listing, reservedStems });
      }

      for (const listing of lockedListings) {
        await tx
          .update(listings)
          .set({
            availableStems: listing.availableStems + listing.reservedStems,
          })
          .where(eq(listings.id, listing.id));
      }

      await tx
        .update(orders)
        .set({ status: 'cancelled', updatedAt: transitionedAt })
        .where(eq(orders.id, order.id));
      await tx
        .update(payments)
        .set({ status: 'failed', updatedAt: transitionedAt })
        .where(eq(payments.id, payment.id));
      await this.integrationOutbox?.enqueueOrderEvent(tx, {
        eventType: 'order.cancelled',
        source: order.synthetic ? 'scenario' : 'customer',
        order,
        items,
        payment: { status: 'failed', provider: payment.provider, paidAt: null },
      });

      return { handled: true };
    });

    if (result.orderPaidEmail) {
      await this.notifications?.sendOrderPaid(result.orderPaidEmail).catch(() => undefined);
    }

    return { handled: result.handled, reason: result.reason };
  }

  private async loadIntegrationItems(
    tx: Database,
    orderId: string,
  ): Promise<PaymentIntegrationOrderItem[]> {
    if (!this.integrationOutbox) {
      return [];
    }

    return tx
      .select({
        id: orderItems.id,
        listingId: orderItems.listingId,
        quantity: orderItems.quantity,
        unitPriceUsd: orderItems.unitPriceUsd,
        productName: orderItems.productName,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
  }
}
