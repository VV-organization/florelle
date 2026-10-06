import { and, eq, ne, sql } from 'drizzle-orm';
import type { Database } from '../../shared/db/client';
import { orders } from '../../shared/db/schema/orders';
import { checkoutAttempts } from '../../shared/db/schema/checkout';
import { payments } from '../../shared/db/schema/payments';
import { AppError } from '../../shared/middleware/error.middleware';
import type { CommerceService } from './commerce.service';
import type { CheckoutInput } from './pricing';

export type ScenarioCheckoutResult = { order: { id: string }; paymentUrl?: string };
export interface SafeScenarioCheckout {
  readonly durableCheckout: true;
  readonly supportsAuthoritativeCancellation: boolean;
  createSyntheticCheckoutPaymentReached(input: { userId: string; scenarioRunId: string; request: CheckoutInput }): Promise<ScenarioCheckoutResult>;
  resumeSyntheticCheckoutPaymentReached(input: { orderId: string; scenarioRunId: string }): Promise<ScenarioCheckoutResult>;
  cancelSyntheticCheckoutPaymentReached(input: { orderId: string; scenarioRunId: string }): Promise<void>;
}

/** Arcopay has no cancellation contract here. Pending reservations remain held. */
export class ScenarioCheckoutService implements SafeScenarioCheckout {
  readonly durableCheckout = true as const;
  readonly supportsAuthoritativeCancellation = false;

  constructor(private readonly db: Database, private readonly commerce: CommerceService) {}

  async createSyntheticCheckoutPaymentReached(input: { userId: string; scenarioRunId: string; request: CheckoutInput }): Promise<ScenarioCheckoutResult> {
    return this.db.transaction(async (tx) => {
      // Serialize manual scenario runs, including across backend instances.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('florelle-synthetic-checkout', 0))`);
      const [unresolved] = await tx.select({ id: orders.id }).from(orders).where(and(
        eq(orders.synthetic, true), eq(orders.status, 'pending'), ne(orders.scenarioRunId, input.scenarioRunId),
      )).limit(1);
      if (unresolved) throw new AppError(409, 'SYNTHETIC_PREVIOUS_ATTEMPT_UNRESOLVED', 'A previous synthetic payment is awaiting an authoritative provider result', { orderId: unresolved.id });
      return this.commerce.createOrder(input.userId, input.request, `vv-admin/${input.scenarioRunId}`, input.scenarioRunId);
    });
  }

  async resumeSyntheticCheckoutPaymentReached(input: { orderId: string; scenarioRunId: string }): Promise<ScenarioCheckoutResult> {
    const order = await this.scenarioOrder(input);
    const resumed = await this.commerce.resume(order.buyerId, order.id);
    return { order: { id: order.id }, ...(resumed.paymentUrl ? { paymentUrl: resumed.paymentUrl } : {}) };
  }

  async cancelSyntheticCheckoutPaymentReached(input: { orderId: string; scenarioRunId: string }): Promise<void> {
    const order = await this.scenarioOrder(input);
    const [attempt] = await this.db.select().from(checkoutAttempts).where(eq(checkoutAttempts.orderId, order.id)).limit(1);
    const [payment] = await this.db.select().from(payments).where(eq(payments.orderId, order.id)).limit(1);
    // The verified webhook already restores inventory exactly once. This adapter
    // never invents a provider failure and never releases an uncertain hold.
    if (order.status === 'cancelled' && attempt?.state === 'failed' && payment?.status === 'failed') return;
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
