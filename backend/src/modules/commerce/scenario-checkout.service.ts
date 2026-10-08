import { and, eq } from 'drizzle-orm';
import type { Database } from '../../shared/db/client';
import { orders } from '../../shared/db/schema/orders';
import { checkoutAttempts } from '../../shared/db/schema/checkout';
import { payments } from '../../shared/db/schema/payments';
import { AppError } from '../../shared/middleware/error.middleware';
import type { ArcPayService } from '../payments/arc-pay.service';
import { verifyHostedPaymentPage } from './scenario-hosted-page';
import type { CommerceService } from './commerce.service';
import type { CheckoutInput } from './pricing';

export type ScenarioCheckoutResult = { order: { id: string }; paymentUrl?: string };
export interface SafeScenarioCheckout {
  readonly durableCheckout: true;
  readonly supportsAuthoritativeCancellation: boolean;
  readonly supportsDeferredCleanup?: boolean;
  createSyntheticCheckoutPaymentReached(input: { userId: string; scenarioRunId: string; request: CheckoutInput }): Promise<ScenarioCheckoutResult>;
  resumeSyntheticCheckoutPaymentReached(input: { orderId: string; scenarioRunId: string }): Promise<ScenarioCheckoutResult>;
  cancelSyntheticCheckoutPaymentReached(input: { orderId: string; scenarioRunId: string }): Promise<void>;
}

/** Arcopay has no cancellation contract here. Pending reservations remain held. */
export class ScenarioCheckoutService implements SafeScenarioCheckout {
  readonly durableCheckout = true as const;
  readonly supportsAuthoritativeCancellation = false;

  readonly supportsDeferredCleanup: boolean;
  constructor(
    private readonly db: Database,
    private readonly commerce: CommerceService,
    private readonly arcPay?: Pick<ArcPayService, 'reconcile'>,
    private readonly verifyPage = verifyHostedPaymentPage,
  ) { this.supportsDeferredCleanup = !!arcPay; }

  async createSyntheticCheckoutPaymentReached(input: { userId: string; scenarioRunId: string; request: CheckoutInput }): Promise<ScenarioCheckoutResult> {
    return this.commerce.createOrder(input.userId, input.request, `vv-admin/${input.scenarioRunId}`, input.scenarioRunId);
  }

  async resumeSyntheticCheckoutPaymentReached(input: { orderId: string; scenarioRunId: string }): Promise<ScenarioCheckoutResult> {
    const order = await this.scenarioOrder(input);
    const resumed = await this.commerce.resume(order.buyerId, order.id);
    return { order: { id: order.id }, ...(resumed.paymentUrl ? { paymentUrl: resumed.paymentUrl } : {}) };
  }

  async cancelSyntheticCheckoutPaymentReached(input: { orderId: string; scenarioRunId: string }): Promise<void> {
    await this.scenarioOrder(input);
    if (this.arcPay) await this.arcPay.reconcile(input.orderId);
    const order = await this.scenarioOrder(input);
    const [attempt] = await this.db.select().from(checkoutAttempts).where(eq(checkoutAttempts.orderId, order.id)).limit(1);
    const [payment] = await this.db.select().from(payments).where(eq(payments.orderId, order.id)).limit(1);
    // The verified webhook already restores inventory exactly once. This adapter
    // never invents a provider failure and never releases an uncertain hold.
    if (order.status === 'cancelled' && attempt?.state === 'failed' && !attempt.reviewReason && payment?.status === 'failed') return;
    if (this.arcPay) {
      if (order.status !== 'pending' || attempt?.state === 'review' || attempt?.reviewReason) {
        throw new AppError(409, 'SYNTHETIC_PAYMENT_REVIEW_REQUIRED', 'Synthetic payment requires operator review');
      }
      if (!attempt?.paymentUrl) throw new AppError(503, 'SYNTHETIC_HOSTED_PAGE_UNAVAILABLE', 'Hosted payment page is unavailable');
      await this.verifyPage(attempt.paymentUrl);
    }
    throw new AppError(409, 'SYNTHETIC_PAYMENT_UNRESOLVED', 'Synthetic payment requires an authoritative provider result before cleanup');
  }

  private async scenarioOrder(input: { orderId: string; scenarioRunId: string }) {
    const [order] = await this.db.select().from(orders).where(and(
      eq(orders.id, input.orderId), eq(orders.synthetic, true), eq(orders.scenarioRunId, input.scenarioRunId),
    )).limit(1);
    if (!order) throw new AppError(404, 'SYNTHETIC_ORDER_NOT_FOUND', 'Synthetic scenario order not found');
    return order;
  }
}
