import { createHash, createHmac } from 'node:crypto';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../shared/db/client';
import { errorHandler } from '../../../shared/middleware/error.middleware';
import type { SafeScenarioCheckout } from '../../commerce/scenario-checkout.service';
import type { PaymentProvider } from '../../payments/payment-provider';
import { buildIntegrationConfig } from '../integration.config';
import { buildIntegrationRouter } from '../integration.router';
import {
  IntegrationService,
  type ScenarioResult,
} from '../integration.service';
import { isAuthorizedVvAdminScenarioRequest } from '../vv-admin-scenario-auth';

const integrationSecret = 'integration-secret';
const scenarioPath = '/api/v1/integration/scenarios/checkout-payment-reached/run';
const runId = 'cmst1syntheticrun000000000001';
const requestedAt = new Date().toISOString();

describe('Florelle checkout-payment-reached scenario', () => {
  it('rejects a missing or invalid HMAC before starting a checkout', async () => {
    const runScenario = vi.fn();
    const app = await buildTestApp({ runCheckoutPaymentReachedScenario: runScenario });

    const missing = await app.inject({
      method: 'POST',
      url: scenarioPath,
      payload: scenarioPayload(),
    });
    const invalid = await app.inject({
      method: 'POST',
      url: scenarioPath,
      headers: scenarioHeaders('not-a-valid-signature'),
      payload: scenarioPayload(),
    });

    expect(missing.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(401);
    expect(runScenario).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects an expired otherwise valid HMAC', () => {
    const expiredTimestamp = '2026-08-14T10:00:00.000Z';
    const body = JSON.stringify(scenarioPayload());
    const bodyHash = createHash('sha256').update(body).digest('hex');
    const signature = createHmac('sha256', integrationSecret)
      .update(['POST', scenarioPath, expiredTimestamp, bodyHash].join('\n'))
      .digest('hex');

    expect(isAuthorizedVvAdminScenarioRequest({
      secret: integrationSecret,
      signature,
      timestamp: expiredTimestamp,
      path: scenarioPath,
      body,
      now: new Date('2026-08-14T10:05:00.001Z'),
    })).toBe(false);
  });

  it('accepts VV Admin scenario signing with the integration secret and passes its CUID run id to the scenario', async () => {
    const result = healthyResult();
    const runScenario = vi.fn().mockResolvedValue(result);
    const app = await buildTestApp({ runCheckoutPaymentReachedScenario: runScenario });
    const body = JSON.stringify(scenarioPayload());

    const response = await app.inject({
      method: 'POST',
      url: scenarioPath,
      headers: scenarioHeaders(signScenarioRequest(scenarioPath, body)),
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    expect(runScenario).toHaveBeenCalledWith({ scenarioRunId: runId });
    await app.close();
  });

  it('rejects the legacy unsafe scenario implementation and does not advertise unsupported cleanup', async () => {
    const legacy = { createSyntheticCheckoutPaymentReached: vi.fn(), cancelSyntheticCheckoutPaymentReached: vi.fn() };
    const service = createScenarioService(createDbMock([]), legacy as unknown as SafeScenarioCheckout);
    expect(await service.runCheckoutPaymentReachedScenario({ scenarioRunId: runId })).toMatchObject({ status: 'down', error: 'scenario_checkout_unavailable' });
    expect(service.getManifest().syntheticScenarios).toEqual([]);
    expect(legacy.createSyntheticCheckoutPaymentReached).not.toHaveBeenCalled();
  });

  it('uses the real checkout service, cancels it, and returns only V1 redacted evidence', async () => {
    const orderId = '00000000-0000-4000-8000-000000000010';
    const userId = '00000000-0000-4000-8000-000000000020';
    const db = createDbMock([[], [{ userId, customerType: 'legal_entity' }]]);
    const ordersService = {
      durableCheckout: true as const,
      supportsAuthoritativeCancellation: false,
      resumeSyntheticCheckoutPaymentReached: vi.fn(),
      createSyntheticCheckoutPaymentReached: vi.fn().mockResolvedValue({
        order: { id: orderId },
        paymentUrl: 'https://mock-pay.example.com/pay/scenario-1',
      }),
      cancelSyntheticCheckoutPaymentReached: vi.fn().mockResolvedValue(undefined),
    };
    const service = createScenarioService(db, ordersService);

    const result = await service.runCheckoutPaymentReachedScenario({ scenarioRunId: runId });

    expect(result).toEqual(healthyResult(orderId));
    expect(ordersService.createSyntheticCheckoutPaymentReached).toHaveBeenCalledWith({
      userId,
      scenarioRunId: runId,
      request: expect.objectContaining({ segment: 'b2b' }),
    });
    expect(ordersService.cancelSyntheticCheckoutPaymentReached).toHaveBeenCalledWith({
      orderId,
      scenarioRunId: runId,
    });
    expect(JSON.stringify(result)).not.toContain('paymentUrl');
  });

  it('replays a cancelled synthetic order without recreating it', async () => {
    const orderId = '00000000-0000-4000-8000-000000000010';
    const db = createDbMock([[
      { orderId, paymentUrlHost: 'mock-pay.example.com', status: 'cancelled' },
    ]]);
    const ordersService = {
      durableCheckout: true as const,
      supportsAuthoritativeCancellation: false,
      resumeSyntheticCheckoutPaymentReached: vi.fn(),
      createSyntheticCheckoutPaymentReached: vi.fn(),
      cancelSyntheticCheckoutPaymentReached: vi.fn(),
    };
    const service = createScenarioService(db, ordersService);

    await expect(
      service.runCheckoutPaymentReachedScenario({ scenarioRunId: runId }),
    ).resolves.toEqual(healthyResult(orderId));
    expect(ordersService.createSyntheticCheckoutPaymentReached).not.toHaveBeenCalled();
    expect(ordersService.cancelSyntheticCheckoutPaymentReached).not.toHaveBeenCalled();
  });

  it('returns attention evidence when payment was reached but cleanup fails', async () => {
    const orderId = '00000000-0000-4000-8000-000000000010';
    const userId = '00000000-0000-4000-8000-000000000020';
    const db = createDbMock([[], [{ userId, customerType: 'individual' }]]);
    const ordersService = {
      durableCheckout: true as const,
      supportsAuthoritativeCancellation: false,
      resumeSyntheticCheckoutPaymentReached: vi.fn(),
      createSyntheticCheckoutPaymentReached: vi.fn().mockResolvedValue({
        order: { id: orderId },
        paymentUrl: 'https://mock-pay.example.com/pay/scenario-1',
      }),
      cancelSyntheticCheckoutPaymentReached: vi.fn().mockRejectedValue(new Error('db failed')),
    };
    const service = createScenarioService(db, ordersService);

    await expect(
      service.runCheckoutPaymentReachedScenario({ scenarioRunId: runId }),
    ).resolves.toEqual({
      ...healthyResult(orderId),
      summary: 'Оплата достигнута, но тестовый заказ требует очистки',
      error: 'synthetic_checkout_cleanup_failed',
      syntheticEntities: [{ type: 'order', externalId: orderId, cleanupStatus: 'failed' }],
    });
  });

  it('prepares a synthetic checkout fixture when no reusable cart exists', async () => {
    const orderId = '00000000-0000-4000-8000-000000000010';
    const userId = '00000000-0000-4000-8000-000000000020';
    const db = createDbMock([[], []]);
    attachSyntheticFixturePreparation(db, { userId });
    const ordersService = {
      durableCheckout: true as const,
      supportsAuthoritativeCancellation: false,
      resumeSyntheticCheckoutPaymentReached: vi.fn(),
      createSyntheticCheckoutPaymentReached: vi.fn().mockResolvedValue({
        order: { id: orderId },
        paymentUrl: 'https://mock-pay.example.com/pay/scenario-1',
      }),
      cancelSyntheticCheckoutPaymentReached: vi.fn(),
    };
    const service = createScenarioService(db, ordersService);

    await expect(
      service.runCheckoutPaymentReachedScenario({ scenarioRunId: runId }),
    ).resolves.toEqual(healthyResult(orderId));
    expect(ordersService.createSyntheticCheckoutPaymentReached).toHaveBeenCalledWith({
      userId,
      scenarioRunId: runId,
      request: expect.objectContaining({ segment: 'b2b' }),
    });
  });
});

function scenarioPayload() {
  return {
    runId,
    siteId: 'cmst1epyr0000ooqx27vp3a1j',
    scenarioKey: 'checkout_payment_reached',
    requestedAt,
  };
}

function scenarioHeaders(signature: string) {
  return {
    'content-type': 'application/json',
    'x-vv-admin-timestamp': requestedAt,
    'x-vv-admin-signature': signature,
  };
}

function signScenarioRequest(path: string, body: string): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return createHmac('sha256', integrationSecret)
    .update(['POST', path, requestedAt, bodyHash].join('\n'))
    .digest('hex');
}

function healthyResult(orderId = '00000000-0000-4000-8000-000000000010'): ScenarioResult {
  return {
    status: 'healthy',
    summary: 'Пользовательский тест дошел до оплаты и отменил тестовый заказ',
    error: null,
    payment: { reached: true },
    syntheticEntities: [{ type: 'order', externalId: orderId, cleanupStatus: 'cancelled' }],
    steps: null,
    artifacts: null,
    metadata: null,
  };
}

function createDbMock(limitResults: unknown[][]) {
  const db = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
    transaction: vi.fn(),
  };
  for (const result of limitResults) db.limit.mockResolvedValueOnce(result);
  return db as unknown as Database;
}

function attachSyntheticFixturePreparation(
  db: Database,
  fixture: { userId: string },
) {
  const cartId = '00000000-0000-4000-8000-000000000030';
  const listingId = '00000000-0000-4000-8000-000000000040';
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([{ listingId }]),
  };
  const tx = {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi
      .fn()
      .mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{
              id: fixture.userId,
              customerType: 'legal_entity',
            }]),
          }),
        }),
      })
      .mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: cartId }]),
        }),
      })
      .mockReturnValueOnce({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  };

  vi.mocked(db.transaction).mockImplementation(async (callback) => callback(tx));
}

function createScenarioService(
  db: Database,
  ordersService: SafeScenarioCheckout,
) {
  return new IntegrationService(
    db,
    { ping: vi.fn().mockResolvedValue('PONG') },
    {} as PaymentProvider,
    buildIntegrationConfig({
      VV_ADMIN_INTEGRATION_ENABLED: 'false',
      VV_ADMIN_INTEGRATION_SECRET: integrationSecret,
    }),
    ordersService,
  );
}

async function buildTestApp(service: {
  runCheckoutPaymentReachedScenario: (
    input: { scenarioRunId: string },
  ) => Promise<ScenarioResult>;
}) {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  await app.register(
    buildIntegrationRouter(
      service as IntegrationService,
      buildIntegrationConfig({
        VV_ADMIN_INTEGRATION_ENABLED: 'false',
        VV_ADMIN_INTEGRATION_SECRET: integrationSecret,
      }),
    ),
    { prefix: '/api/v1/integration' },
  );
  return app;
}
