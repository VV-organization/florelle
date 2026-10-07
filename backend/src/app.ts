import { ArcPayRateGate } from './modules/payments/arc-pay-rate-gate';
import { ArcPayClient } from './modules/payments/arc-pay-client';
import { ArcPayService } from './modules/payments/arc-pay.service';
import { buildArcPayRouter } from './modules/payments/arc-pay.router';
import { ScenarioCheckoutService } from './modules/commerce/scenario-checkout.service';
import { CommerceService } from './modules/commerce/commerce.service';
import { CommerceWebhookService } from './modules/commerce/commerce-webhook.service';
import { buildCommerceRouter } from './modules/commerce/commerce.router';
import { buildStorefrontRouter } from './modules/storefront/storefront.router';
import { buildMediaRouter } from './modules/media/media.router';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import scalarApiReference from '@scalar/fastify-api-reference';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { buildAuthRouter } from './modules/auth/auth.router';
import { AuthService } from './modules/auth/auth.service';
import { buildCatalogRouter } from './modules/catalog/catalog.router';
import { CatalogService } from './modules/catalog/catalog.service';
import { buildCurrencyRouter } from './modules/currency/currency.router';
import { CurrencyService } from './modules/currency/currency.service';
import { buildIntegrationConfig } from './modules/integration/integration.config';
import { CatalogProtocolService } from './modules/integration/catalog-protocol.service';
import { buildIntegrationRouter } from './modules/integration/integration.router';
import { IntegrationService } from './modules/integration/integration.service';
import { VvAdminOutbox } from './modules/integration/vv-admin-outbox';
import { type OrdersIntegrationOutbox } from './modules/orders/orders.service';
import { NotificationsService } from './modules/notifications/notifications.service';
import { ArcopayPaymentProvider } from './modules/payments/arcopay-payment-provider';
import { DisabledPaymentProvider } from './modules/payments/disabled-payment-provider';
import { buildMediaUploadRouter } from './modules/media/media-upload';
import { buildPaymentsRouter } from './modules/payments/payments.router';
import { type PaymentIntegrationOutbox } from './modules/payments/payments.service';
import type { PaymentProvider } from './modules/payments/payment-provider';
import { FxService } from './shared/currency/fx.service';
import { db } from './shared/db/client';
import { env } from './shared/env';
import { createAuthenticateHandler } from './shared/middleware/auth.middleware';
import { errorHandler } from './shared/middleware/error.middleware';
import { redis } from './shared/redis/client';

const API_PREFIX = '/api/v1';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: ReturnType<typeof createAuthenticateHandler>;
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        env.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            }
          : undefined,
    },
    disableRequestLogging: false,
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler(errorHandler);

  await app.register(cors, {
    origin: env.NODE_ENV === 'production' ? false : true,
    credentials: true,
  });

  await app.register(cookie);

  await app.register(swagger, {
    transform: jsonSchemaTransform,
    openapi: {
      info: {
        title: 'Florelle API',
        description: 'Florelle retail and wholesale commerce API',
        version: '0.1.0',
      },
      servers: [{ url: `http://${env.HOST}:${env.PORT}${API_PREFIX}` }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  await app.register(scalarApiReference, {
    routePrefix: '/docs',
    configuration: {
      theme: 'purple',
    },
  });

  app.get('/health', async () => ({ status: 'ok' }));

  const notificationsService = new NotificationsService(env.EMAIL_FROM, {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD,
    },
  });

  const authService = new AuthService(db, redis, {
    accessSecret: new TextEncoder().encode(env.JWT_ACCESS_SECRET),
    refreshSecret: new TextEncoder().encode(env.JWT_REFRESH_SECRET),
    accessTtl: env.JWT_ACCESS_TTL,
    refreshTtl: env.JWT_REFRESH_TTL,
    refreshTtlSeconds: parseTtlToSeconds(env.JWT_REFRESH_TTL),
    registrationCodeTtlSeconds: 10 * 60,
    registrationCodePepper: env.JWT_REFRESH_SECRET,
  }, notificationsService);

  app.decorate('authenticate', createAuthenticateHandler(authService));

  const fxService = new FxService(db, redis, {
    apiKey: env.FX_API_KEY,
    baseCurrency: env.FX_BASE_CURRENCY,
    cacheTtlSeconds: env.FX_CACHE_TTL_SECONDS,
    markup: env.PLATFORM_RETAIL_MARKUP,
    offline: env.FX_OFFLINE,
  });

  const catalogService = new CatalogService(db, fxService);
  const currencyService = new CurrencyService(fxService);

  const paymentProvider = createPaymentProvider(fxService);
  const arcClient = env.PAYMENT_PROVIDER === 'arc_pay' ? new ArcPayClient({baseUrl:env.ARC_PAY_BASE_URL,secretKey:env.ARC_PAY_SECRET_KEY!,rateGate:new ArcPayRateGate(db,env.ARC_PAY_SECRET_KEY!.startsWith("sk_live_")?"live":"sandbox")}) : undefined;
  const integrationConfig = buildIntegrationConfig(env);
  const catalogProtocolService = new CatalogProtocolService(
    db,
    `https://${integrationConfig.siteDomain}`,
  );
  const integrationService = new IntegrationService(
    db,
    redis,
    arcClient ?? (env.PAYMENT_PROVIDER === 'arcopay' ? paymentProvider : undefined),
    integrationConfig,
  );

  app.get('/.well-known/vv-admin/manifest.json', async () =>
    integrationService.getManifest(),
  );
  if (integrationConfig.dispatch.enabled) {
    const outbox = new VvAdminOutbox(db, {
      url: env.VV_ADMIN_WEBHOOK_URL!,
      siteKey: env.VV_ADMIN_WEBHOOK_SITE_KEY!,
      secret: env.VV_ADMIN_WEBHOOK_SECRET!,
      secretVersion: String(env.VV_ADMIN_WEBHOOK_SECRET_VERSION!),
    });
    let dispatching = false;
    const dispatch = async () => {
      if (dispatching) return;
      dispatching = true;
      try {
        await outbox.dispatchDueEvents({ limit: 25 });
      } catch (error) {
        app.log.error({ err: error }, 'failed to dispatch VV Admin outbox events');
      } finally {
        dispatching = false;
      }
    };
    const timer = setInterval(() => void dispatch(), 5_000);
    timer.unref();
    app.addHook('onClose', () => clearInterval(timer));
    void dispatch();
  }
  const apiBaseUrl = (env.PUBLIC_API_URL ?? `http://${env.HOST}:${env.PORT}${API_PREFIX}`).replace(/\/$/, '');
  const frontendBaseUrl = (env.PUBLIC_FRONTEND_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  const ordersIntegrationOutbox: OrdersIntegrationOutbox = {
    enqueueOrderEvent: (tx, input) => VvAdminOutbox.enqueueOrderEvent(tx, {
      eventType: input.eventType,
      event: integrationService.buildOrderEvent({
        ...input,
        occurredAt: new Date(),
      }),
      order: input.order,
    }),
  };
  const paymentIntegrationOutbox: PaymentIntegrationOutbox = {
    enqueueOrderEvent: (tx, input) => VvAdminOutbox.enqueueOrderEvent(tx, {
      eventType: input.eventType,
      event: integrationService.buildOrderEvent({
        ...input,
        occurredAt: new Date(),
      }),
      order: input.order,
    }),
  };

  const arcPay = arcClient ? new ArcPayService(db, arcClient, {
    enqueueOrderEvent: (tx,input) => VvAdminOutbox.enqueueOrderEvent(tx, {
      eventType:input.eventType, order:input.order,
      event:integrationService.buildOrderEvent({...input,occurredAt:new Date()}),
    }),
  }, notificationsService) : undefined;
  const commerceService = new CommerceService(db, fxService, paymentProvider, {
    commissionPercent: env.PLATFORM_COMMISSION_PERCENT, cartTtlHours: 24,
    callbackUrl: `${apiBaseUrl}/payments/callback`, successUrl: `${frontendBaseUrl}/orders/{orderId}`,
    failUrl: `${frontendBaseUrl}/orders/{orderId}`, paymentsEnabled: ['arcopay','arc_pay'].includes(env.PAYMENT_PROVIDER),
  }, ordersIntegrationOutbox, arcPay);
  integrationService.setScenarioOrdersService(new ScenarioCheckoutService(db, commerceService));
  const recoverPayments = async () => {
    await commerceService.recoverPaymentLinks();
    await arcPay?.tick();
  };
  const paymentRecoveryTimer = setInterval(() => recoverPayments().catch(() => app.log.error('payment recovery failed')), 15000);
  paymentRecoveryTimer.unref();
  app.addHook('onClose', () => clearInterval(paymentRecoveryTimer));
  await app.register(buildMediaRouter(env.MEDIA_ROOT));
  await app.register(buildMediaUploadRouter(db,{adminToken:integrationConfig.adminToken,mediaRoot:env.MEDIA_ROOT}));
  const webhookService = new CommerceWebhookService(
    db,
    paymentProvider,
    paymentIntegrationOutbox,
    notificationsService,
  );

  await app.register(buildIntegrationRouter(integrationService, integrationConfig, catalogProtocolService), {
    prefix: '/admin/integration',
  });
  await app.register(buildIntegrationRouter(integrationService, integrationConfig, catalogProtocolService), {
    prefix: `${API_PREFIX}/integration`,
  });

  app.get('/health/ready', async () => integrationService.getReadiness());
  app.get<{ Params: { component: string } }>(
    '/health/ready/:component',
    async (request, reply) => {
      const readiness = await integrationService.getReadiness();
      const check = readiness.checks.find(
        (candidate) => candidate.name === request.params.component,
      );
      if (!check) {
        return reply.status(404).send({ status: 'not_found' });
      }
      if (check.status !== 'ok') {
        return reply.status(503).send({ status: 'down', check });
      }
      return { status: 'ok', check };
    },
  );

  await app.register(
    async (api) => {
      await api.register(buildAuthRouter(authService, { isProduction: env.NODE_ENV === 'production' }), { prefix: '/auth' });
      await api.register(buildCatalogRouter(catalogService));
      await api.register(buildCurrencyRouter(currencyService));
      await api.register(buildStorefrontRouter(db, catalogService, fxService));
      await api.register(buildCommerceRouter(commerceService, app.authenticate));
      await api.register(buildPaymentsRouter(webhookService));
      if (arcPay) await api.register(buildArcPayRouter(arcPay, env.ARC_PAY_WEBHOOK_SECRET!));
    },
    { prefix: API_PREFIX },
  );

  return app;
}

function createPaymentProvider(fxService: FxService): PaymentProvider {
  if (env.PAYMENT_PROVIDER !== 'arcopay' && !(env.ARCOPAY_API_URL && env.ARCOPAY_API_KEY && env.ARCOPAY_BEARER_TOKEN && env.ARCOPAY_PUBLIC_KEY)) {
    return new DisabledPaymentProvider();
  }

  const apiUrl = requireEnv('ARCOPAY_API_URL', env.ARCOPAY_API_URL);
  const apiKey = requireEnv('ARCOPAY_API_KEY', env.ARCOPAY_API_KEY);
  const bearerToken = requireEnv('ARCOPAY_BEARER_TOKEN', env.ARCOPAY_BEARER_TOKEN);
  const publicKey = requireEnv('ARCOPAY_PUBLIC_KEY', env.ARCOPAY_PUBLIC_KEY);

  return new ArcopayPaymentProvider({
    apiUrl,
    apiKey,
    bearerToken,
    publicKey,
    convertUsdToRub: (amountUsd) => fxService.convert(amountUsd, 'RUB'),
  });
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is required when PAYMENT_PROVIDER=arcopay`);
  }
  return value;
}

/**
 * Parse JWT TTL strings like '15m', '30d', '1h' into seconds.
 * Used to set Redis EX for refresh token sessions.
 */
function parseTtlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 2592000; // default 30d
  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * (multipliers[unit] ?? 1);
}
