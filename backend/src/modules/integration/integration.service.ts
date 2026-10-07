import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { Database } from '../../shared/db/client';
import { carts, cartItems } from '../../shared/db/schema/carts';
import { listings } from '../../shared/db/schema/listings';
import { orders } from '../../shared/db/schema/orders';
import { users } from '../../shared/db/schema/users';
import type { RedisClient } from '../../shared/redis/client';
import type { CreateOrderBody } from '../orders/orders.schema';
import type { SafeScenarioCheckout } from '../commerce/scenario-checkout.service';
import { AppError } from '../../shared/middleware/error.middleware';
import type { PaymentProvider } from '../payments/payment-provider';
import type { IntegrationConfig } from './integration.config';
import { flowerPointCatalogCapability } from './catalog-protocol.service';

export type IntegrationReadiness = {
  status: 'ready' | 'not_configured' | 'degraded';
  checks: Array<{
    name: 'postgres' | 'redis' | 'payment_provider' | 'vv_admin_dispatch';
    status: 'ok' | 'not_configured' | 'failed';
    message: string;
  }>;
};

type IntegrationManifest = {
  site: {
    key: 'florelle';
    displayName: 'Florelle';
    publicOrigin: string;
    adminOrigin: string;
  };
  commerceEvents: {
    schemaVersion: 1;
    delivery: 'site_to_vv_admin_webhook';
  };
  healthChecks: Array<{
    key: string;
    label: string;
    kind: 'http_status';
    method: 'GET';
    url: string;
    timeoutMs: number;
    intervalSeconds: number;
  }>;
  syntheticScenarios: Array<{
    key: 'checkout_payment_reached';
    label: string;
    kind: 'synthetic_transaction';
    productionSafe: true;
    effect: 'creates_synthetic_entities';
    requiresCleanup: true;
    timeoutMs: number;
    intervalSeconds: number;
    run: {
      method: 'POST';
      url: string;
    };
  }>;
  actions: [];
  catalog: ReturnType<typeof flowerPointCatalogCapability>;
};

type ReadinessDatabase = Pick<Database, 'execute'>;
type IntegrationDatabase = ReadinessDatabase & Partial<Pick<Database, 'select'>>;
type ReadinessRedis = Pick<RedisClient, 'ping'>;

export type ScenarioResult = {
  status: 'healthy' | 'down';
  summary: string;
  error: string | null;
  payment: { reached: boolean };
  syntheticEntities: Array<{
    type: 'order';
    externalId: string;
    cleanupStatus: 'cancelled' | 'failed';
  }>;
  steps: null;
  artifacts: null;
  metadata: null;
};

const SYNTHETIC_CUSTOMER_EMAIL = 'vv-admin-scenario@florelle.invalid';
const SYNTHETIC_CART_TTL_MS = 2 * 60 * 60 * 1000;

type OrderEventType =
  | 'order.created'
  | 'order.payment_reached'
  | 'order.paid'
  | 'order.cancelled';

export type BuildOrderEventInput = {
  eventType: OrderEventType;
  occurredAt: Date;
  source: string;
  order: {
    id: string;
    merchantOrderId: string | null;
    totalUsd: string;
    createdAt: Date;
  };
  items: Array<{
    id: string;
    listingId: string;
    quantity: number;
    unitPriceUsd: string;
    productName: string | null;
  }>;
  payment: {
    status: string;
    provider: string;
    paidAt: Date | null;
  };
};

export type VvAdminOrderEvent = {
  schemaVersion: 2;
  eventType: 'order.created' | 'order.paid' | 'order.cancelled';
  occurredAt: string;
  source: string;
  site: { domain: string };
  subject: { type: 'order'; externalId: string };
  data: {
    status: 'created' | 'completed' | 'cancelled';
    externalOrderId: string;
    merchantOrderId: string | null;
    totalAmount: string;
    currency: 'USD';
    provider: string;
    payment: {
      status: string;
      method: {
        type: 'sbp';
        displayName: string;
        provider: string;
      };
      paidAt: string | null;
    };
    items: Array<{
      externalItemId: string;
      listingId: string;
      quantity: number;
      name: string;
      priceAmount: string;
      currency: 'USD';
    }>;
    createdAt: string;
    milestone?: 'payment_reached';
  };
};

const statusByEventType = {
  'order.created': 'created',
  'order.payment_reached': 'created',
  'order.paid': 'completed',
  'order.cancelled': 'cancelled',
} as const;

export class IntegrationService {
  constructor(
    private readonly db: IntegrationDatabase,
    private readonly redis: ReadinessRedis,
    private readonly paymentProvider: PaymentProvider | { assertAvailable(): Promise<void> } | undefined,
    private readonly config: IntegrationConfig,
    private ordersService?: SafeScenarioCheckout,
  ) {}

  setScenarioOrdersService(
    ordersService: SafeScenarioCheckout,
  ): void {
    this.ordersService = ordersService;
  }

  getManifest(): IntegrationManifest {
    const origin = `https://${this.config.siteDomain}`;
    return {
      site: {
        key: 'florelle',
        displayName: 'Florelle',
        publicOrigin: origin,
        adminOrigin: origin,
      },
      commerceEvents: {
        schemaVersion: 1,
        delivery: 'site_to_vv_admin_webhook',
      },
      healthChecks: [
        healthCheck('frontend_http', 'Frontend', origin, 60),
        healthCheck('backend_http', 'Backend', `${origin}/health`, 60),
        healthCheck('postgres', 'База данных', `${origin}/health/ready/postgres`, 60),
        healthCheck('redis', 'Redis', `${origin}/health/ready/redis`, 60),
        healthCheck('exchange_rate', 'Курс валюты', `${origin}/api/v1/currency/rates`, 900),
        healthCheck('visible_catalog', 'Товары в каталоге', `${origin}/api/v1/products?limit=1`, 900),
      ],
      syntheticScenarios: this.config.protocolSecret && this.ordersService?.durableCheckout && this.ordersService.supportsAuthoritativeCancellation && this.paymentProvider
        ? [{
          key: 'checkout_payment_reached',
          label: 'Пользовательский тест оплаты',
          kind: 'synthetic_transaction',
          productionSafe: true,
          effect: 'creates_synthetic_entities',
          requiresCleanup: true,
          timeoutMs: 45_000,
          intervalSeconds: 900,
          run: {
            method: 'POST',
            url: `${origin}/api/v1/integration/scenarios/checkout-payment-reached/run`,
          },
        }]
        : [],
      actions: [],
      catalog: flowerPointCatalogCapability(origin),
    };
  }

  buildOrderEvent(input: BuildOrderEventInput): VvAdminOrderEvent {
    const isPaymentReached = input.eventType === 'order.payment_reached';
    const eventType: VvAdminOrderEvent['eventType'] =
      input.eventType === 'order.payment_reached'
        ? 'order.created'
        : input.eventType;

    return {
      schemaVersion: 2,
      eventType,
      occurredAt: input.occurredAt.toISOString(),
      source: input.source,
      site: { domain: this.config.siteDomain },
      subject: { type: 'order', externalId: input.order.id },
      data: {
        status: statusByEventType[input.eventType],
        externalOrderId: input.order.id,
        merchantOrderId: input.order.merchantOrderId,
        totalAmount: input.order.totalUsd,
        currency: 'USD',
        provider: input.payment.provider,
        payment: {
          status: isPaymentReached ? 'pending' : input.payment.status,
          method: {
            type: 'sbp',
            displayName: input.payment.provider === 'arc_pay' ? 'Arc Pay SBP' : input.payment.provider === 'arcopay' ? 'Arcopay SBP' : 'SBP',
            provider: input.payment.provider,
          },
          paidAt: isPaymentReached || !input.payment.paidAt
            ? null
            : input.payment.paidAt.toISOString(),
        },
        items: input.items.map((item) => ({
          externalItemId: item.id,
          listingId: item.listingId,
          quantity: item.quantity,
          name: item.productName?.trim() || item.listingId,
          priceAmount: item.unitPriceUsd,
          currency: 'USD',
        })),
        createdAt: input.order.createdAt.toISOString(),
        ...(isPaymentReached ? { milestone: 'payment_reached' as const } : {}),
      },
    };
  }

  async getReadiness(): Promise<IntegrationReadiness> {
    const [postgres, redis] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
    ]);
    let paymentAvailable = !!this.paymentProvider;
    if (this.paymentProvider && 'assertAvailable' in this.paymentProvider) {
      try { await this.paymentProvider.assertAvailable(); } catch { paymentAvailable = false; }
    }
    const checks: IntegrationReadiness['checks'] = [
      postgres,
      redis,
      {
        name: 'payment_provider',
        status: this.paymentProvider ? (paymentAvailable ? 'ok' : 'failed') : 'not_configured',
        message: this.paymentProvider
          ? (paymentAvailable ? 'Payment provider is configured' : 'SBP H2H is unavailable')
          : 'Payment provider is not configured',
      },
      {
        name: 'vv_admin_dispatch',
        status: this.config.dispatch.status,
        message: this.config.dispatch.enabled
          ? 'VV Admin dispatch is configured'
          : 'VV Admin dispatch is not configured',
      },
    ];

    const hasFailure = checks.some((check) => check.status === 'failed');
    const isFullyConfigured = checks.every((check) => check.status === 'ok');

    return {
      status: hasFailure ? 'degraded' : isFullyConfigured ? 'ready' : 'not_configured',
      checks,
    };
  }

  async runCheckoutPaymentReachedScenario(input: {
    scenarioRunId: string;
  }): Promise<ScenarioResult> {
    if (!this.db.select || !this.ordersService?.durableCheckout || !this.paymentProvider) {
      return scenarioDown('Пользовательский тест недоступен', 'scenario_checkout_unavailable');
    }

    const db = this.db as Database;
    try {
      const existingRows = await db
        .select({
          orderId: orders.id,
          paymentUrlHost: orders.scenarioPaymentUrlHost,
          status: orders.status,
        })
        .from(orders)
        .where(
          and(
            eq(orders.scenarioRunId, input.scenarioRunId),
            eq(orders.synthetic, true),
          ),
        )
        .limit(1);
      const existing = existingRows[0];
      if (existing) {
        if (!existing.paymentUrlHost) {
          const resumed = await this.ordersService.resumeSyntheticCheckoutPaymentReached({ orderId: existing.orderId, scenarioRunId: input.scenarioRunId });
          if (!resumed.paymentUrl) return scenarioDown('Платёж ожидает подтверждения провайдера', 'synthetic_payment_pending', existing.orderId, 'failed');
          assertSafePaymentUrl(resumed.paymentUrl);
        }
        if (existing.status === 'cancelled') {
          return scenarioHealthy(existing.orderId, 'cancelled');
        }
        return this.cancelReachedScenario(existing.orderId, input.scenarioRunId);
      }

      const fixture =
        (await findSyntheticCheckoutFixture(db)) ??
        (await prepareSyntheticCheckoutFixture(db));
      if (!fixture) {
        return scenarioDown(
          'Пользовательский тест не готов к запуску',
          'synthetic_checkout_fixture_unavailable',
        );
      }

      const request = buildSyntheticCheckoutRequest(fixture.customerType);
      const checkout = await this.ordersService.createSyntheticCheckoutPaymentReached({
        userId: fixture.userId,
        scenarioRunId: input.scenarioRunId,
        request,
      });
      if (!checkout.paymentUrl) return scenarioDown('Платёж ожидает подтверждения провайдера', 'synthetic_payment_pending', checkout.order.id, 'failed');
      assertSafePaymentUrl(checkout.paymentUrl);
      return this.cancelReachedScenario(checkout.order.id, input.scenarioRunId);
    } catch (error) {
      if (error instanceof AppError && error.code === 'SYNTHETIC_PREVIOUS_ATTEMPT_UNRESOLVED') {
        return scenarioDown('Предыдущий тестовый платёж ожидает подтверждения провайдера', 'synthetic_previous_attempt_unresolved', (error.details as { orderId: string }).orderId, 'failed');
      }
      return scenarioDown(
        'Пользовательский тест не дошел до оплаты',
        'checkout_payment_reached_failed',
      );
    }
  }

  private async cancelReachedScenario(orderId: string, scenarioRunId: string): Promise<ScenarioResult> {
    try {
      await this.ordersService!.cancelSyntheticCheckoutPaymentReached({
        orderId,
        scenarioRunId,
      });
      return scenarioHealthy(orderId, 'cancelled');
    } catch {
      return scenarioHealthy(orderId, 'failed');
    }
  }

  private async checkPostgres(): Promise<IntegrationReadiness['checks'][number]> {
    try {
      await this.db.execute(sql`select 1`);
      return { name: 'postgres', status: 'ok', message: 'PostgreSQL is available' };
    } catch {
      return {
        name: 'postgres',
        status: 'failed',
        message: 'PostgreSQL is unavailable',
      };
    }
  }

  private async checkRedis(): Promise<IntegrationReadiness['checks'][number]> {
    try {
      await this.redis.ping();
      return { name: 'redis', status: 'ok', message: 'Redis is available' };
    } catch {
      return { name: 'redis', status: 'failed', message: 'Redis is unavailable' };
    }
  }
}

function healthCheck(
  key: string,
  label: string,
  url: string,
  intervalSeconds: number,
): IntegrationManifest['healthChecks'][number] {
  return {
    key,
    label,
    kind: 'http_status',
    method: 'GET',
    url,
    timeoutMs: 10_000,
    intervalSeconds,
  };
}

function buildSyntheticCheckoutRequest(
  customerType: 'individual' | 'legal_entity',
): CreateOrderBody {
  const shippingAddress = {
    address: 'VV Admin synthetic checkout, Florelle',
    contactName: 'VV Admin Scenario',
    contactPhone: '+79990000000',
  };

  if (customerType === 'legal_entity') {
    return {
      shippingAddress,
      delivery: { countryCode: 'RU', cityValue: 'Moscow' },
      notes: 'VV Admin synthetic checkout scenario',
      displayCurrency: 'RUB',
      segment: 'b2b',
    };
  }

  return {
    shippingAddress,
    delivery: { countryCode: 'RU', cityValue: 'Moscow' },
    notes: 'VV Admin synthetic checkout scenario',
    displayCurrency: 'RUB',
    segment: 'b2c',
  };
}

async function findSyntheticCheckoutFixture(
  db: Database,
): Promise<{ userId: string; customerType: 'individual' | 'legal_entity' } | null> {
  const fixtureRows = await db
    .select({ userId: users.id, customerType: users.customerType })
    .from(users)
    .innerJoin(carts, eq(carts.userId, users.id))
    .innerJoin(cartItems, eq(cartItems.cartId, carts.id))
    .innerJoin(listings, eq(listings.id, cartItems.listingId))
    .where(
      and(
        eq(users.email, SYNTHETIC_CUSTOMER_EMAIL),
        eq(users.status, 'active'),
        gt(carts.expiresAt, new Date()),
        eq(listings.isActive, true),
        sql`${listings.availableStems} >= CASE
          WHEN ${users.customerType} = 'legal_entity'
          THEN ${cartItems.quantity} * ${listings.boxQuantity}
          ELSE ${cartItems.quantity}
        END`,
      ),
    )
    .limit(1);

  return fixtureRows[0] ?? null;
}

async function prepareSyntheticCheckoutFixture(
  db: Database,
): Promise<{ userId: string; customerType: 'legal_entity' } | null> {
  return db.transaction(async (tx) => {
    const listingRows = await tx
      .select({ listingId: listings.id })
      .from(listings)
      .where(
        and(
          eq(listings.isActive, true),
          sql`${listings.availableStems} >= ${listings.boxQuantity}`,
        ),
      )
      .orderBy(desc(listings.availableStems))
      .limit(1);
    const listing = listingRows[0];
    if (!listing) return null;

    const userRows = await tx
      .insert(users)
      .values({
        email: SYNTHETIC_CUSTOMER_EMAIL,
        passwordHash: 'synthetic-checkout-disabled',
        customerType: 'legal_entity',
        companyName: 'VV Admin Synthetic Scenario',
        status: 'active',
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          passwordHash: 'synthetic-checkout-disabled',
          customerType: 'legal_entity',
          companyName: 'VV Admin Synthetic Scenario',
          firstName: null,
          lastName: null,
          phone: null,
          status: 'active',
          updatedAt: new Date(),
        },
      })
      .returning({ id: users.id, customerType: users.customerType });
    const user = userRows[0];
    if (!user || user.customerType !== 'legal_entity') return null;

    await tx.delete(carts).where(eq(carts.userId, user.id));
    const cartRows = await tx
      .insert(carts)
      .values({
        userId: user.id,
        expiresAt: new Date(Date.now() + SYNTHETIC_CART_TTL_MS),
      })
      .returning({ id: carts.id });
    const cart = cartRows[0];
    if (!cart) return null;

    await tx.insert(cartItems).values({
      cartId: cart.id,
      listingId: listing.listingId,
      quantity: 1,
    });

    return { userId: user.id, customerType: 'legal_entity' };
  });
}

function assertSafePaymentUrl(paymentUrl: string): void {
  const parsed = new URL(paymentUrl);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Unsafe payment URL');
  }
}

function scenarioHealthy(
  orderId: string,
  cleanupStatus: 'cancelled' | 'failed',
): ScenarioResult {
  return {
    status: 'healthy',
    summary: cleanupStatus === 'cancelled'
      ? 'Пользовательский тест дошел до оплаты и отменил тестовый заказ'
      : 'Оплата достигнута, но тестовый заказ требует очистки',
    error: cleanupStatus === 'cancelled' ? null : 'synthetic_checkout_cleanup_failed',
    payment: { reached: true },
    syntheticEntities: [{ type: 'order', externalId: orderId, cleanupStatus }],
    steps: null,
    artifacts: null,
    metadata: null,
  };
}

function scenarioDown(
  summary: string,
  error: string,
  orderId?: string,
  cleanupStatus?: 'cancelled' | 'failed',
): ScenarioResult {
  return {
    status: 'down',
    summary,
    error,
    payment: { reached: false },
    syntheticEntities: orderId && cleanupStatus
      ? [{ type: 'order', externalId: orderId, cleanupStatus }]
      : [],
    steps: null,
    artifacts: null,
    metadata: null,
  };
}
