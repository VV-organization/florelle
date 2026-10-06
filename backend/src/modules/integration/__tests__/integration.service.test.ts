import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';
import { authorizeIntegrationRequest } from '../integration.auth';
import { buildIntegrationConfig } from '../integration.config';
import { buildIntegrationRouter } from '../integration.router';
import { IntegrationService } from '../integration.service';
import { errorHandler } from '../../../shared/middleware/error.middleware';

describe('integration admin auth', () => {
  it('rejects missing bearer token', () => {
    expect(() =>
      authorizeIntegrationRequest(undefined, 'secret-token'),
    ).toThrow('Integration authorization is required');
  });

  it('accepts matching bearer token', () => {
    expect(
      authorizeIntegrationRequest('Bearer secret-token', 'secret-token'),
    ).toEqual({ authorized: true });
  });
});

describe('integration config', () => {
  it('uses the public frontend hostname for outbound event site domains', () => {
    expect(
      buildIntegrationConfig({
        PUBLIC_FRONTEND_URL: 'https://shop.flower-point.example/path?token=ignored',
      }),
    ).toMatchObject({ siteDomain: 'shop.flower-point.example' });
  });

  it('uses a deterministic local site domain without a public frontend URL', () => {
    expect(buildIntegrationConfig({})).toMatchObject({
      siteDomain: 'florelle.local',
    });
  });

  it('prefers the independent Florelle token while preserving legacy compatibility', () => {
    expect(buildIntegrationConfig({ FLORELLE_INTEGRATION_TOKEN: 'florelle-token', FLOWER_POINT_INTEGRATION_TOKEN: 'old-token' }).adminToken).toBe('florelle-token');
    expect(buildIntegrationConfig({ FLOWER_POINT_INTEGRATION_TOKEN: 'old-token' }).adminToken).toBe('old-token');
  });

  it('reports disabled dispatch when integration is not enabled', () => {
    const config = buildIntegrationConfig({
      VV_ADMIN_INTEGRATION_ENABLED: 'false',
      FLOWER_POINT_INTEGRATION_TOKEN: 'admin-token',
    });

    expect(config.dispatch.enabled).toBe(false);
    expect(config.dispatch.status).toBe('not_configured');
  });

  it('does not treat the raw false string as enabled', () => {
    const config = buildIntegrationConfig({
      VV_ADMIN_INTEGRATION_ENABLED: 'false',
      VV_ADMIN_WEBHOOK_URL: 'https://vv-admin.example.com/webhooks/flower-point',
      VV_ADMIN_WEBHOOK_SITE_KEY: 'flower-point',
      VV_ADMIN_WEBHOOK_SECRET: 'webhook-secret',
      VV_ADMIN_WEBHOOK_SECRET_VERSION: 1,
      FLOWER_POINT_INTEGRATION_TOKEN: 'admin-token',
    });

    expect(config.dispatch.enabled).toBe(false);
    expect(config.dispatch.status).toBe('not_configured');
  });
});

describe('IntegrationService', () => {
  it('maps Florelle order rows into a VV Admin order event', () => {
    const service = createService();

    const event = service.buildOrderEvent({
      eventType: 'order.created',
      occurredAt: new Date('2026-08-14T10:00:00.000Z'),
      source: 'customer',
      order: {
        id: 'order-1',
        merchantOrderId: 'FP-123',
        totalUsd: '42.50',
        createdAt: new Date('2026-08-14T09:59:00.000Z'),
      },
      items: [
        {
          id: 'item-1',
          listingId: 'listing-1',
          quantity: 2,
          unitPriceUsd: '21.25',
          productName: 'Red Rose',
        },
      ],
      payment: { status: 'pending', provider: 'arcopay', paidAt: null },
    });

    expect(event).toMatchObject({
      schemaVersion: 2,
      eventType: 'order.created',
      site: { domain: 'florelle.local' },
      subject: { type: 'order', externalId: 'order-1' },
      data: {
        status: 'created',
        externalOrderId: 'order-1',
        totalAmount: '42.50',
        currency: 'USD',
        provider: 'arcopay',
        items: [
          {
            externalItemId: 'item-1',
            listingId: 'listing-1',
            quantity: 2,
            name: 'Red Rose',
            priceAmount: '21.25',
            currency: 'USD',
          },
        ],
      },
    });
    expect(JSON.stringify(event)).not.toContain('signature');
  });

  it('maps payment reached as an order-created milestone until VV Admin supports it', () => {
    const service = createService();

    const event = service.buildOrderEvent({
      eventType: 'order.payment_reached',
      occurredAt: new Date('2026-08-14T10:00:00.000Z'),
      source: 'payment_callback',
      order: {
        id: 'order-1',
        merchantOrderId: 'FP-123',
        totalUsd: '42.50',
        createdAt: new Date('2026-08-14T09:59:00.000Z'),
      },
      items: [],
      payment: {
        status: 'completed',
        provider: 'arcopay',
        paidAt: new Date('2026-08-14T10:00:00.000Z'),
      },
    });

    expect(event).toMatchObject({
      eventType: 'order.created',
      data: {
        status: 'created',
        milestone: 'payment_reached',
        payment: { status: 'pending', paidAt: null },
      },
    });
  });

  it('uses the listing id as a receiver-safe item name when the snapshot name is absent', () => {
    const event = createService().buildOrderEvent({
      eventType: 'order.created',
      occurredAt: new Date('2026-08-14T10:00:00.000Z'),
      source: 'customer',
      order: {
        id: 'order-1',
        merchantOrderId: 'FP-123',
        totalUsd: '21.25',
        createdAt: new Date('2026-08-14T09:59:00.000Z'),
      },
      items: [{
        id: 'item-1',
        listingId: 'listing-1',
        quantity: 1,
        unitPriceUsd: '21.25',
        productName: null,
      }],
      payment: { status: 'pending', provider: 'arcopay', paidAt: null },
    });

    expect(event.data.items[0]).toMatchObject({
      name: 'listing-1',
      priceAmount: '21.25',
      currency: 'USD',
    });
  });

  it('returns a manifest with Florelle operational checks and catalog capability', () => {
    const service = createService();

    expect(service.getManifest()).toEqual({
      site: {
        key: 'florelle',
        displayName: 'Florelle',
        publicOrigin: 'https://florelle.local',
        adminOrigin: 'https://florelle.local',
      },
      commerceEvents: {
        schemaVersion: 1,
        delivery: 'site_to_vv_admin_webhook',
      },
      healthChecks: [
        {
          key: 'frontend_http',
          label: 'Frontend',
          kind: 'http_status',
          method: 'GET',
          url: 'https://florelle.local',
          timeoutMs: 10_000,
          intervalSeconds: 60,
        },
        {
          key: 'backend_http',
          label: 'Backend',
          kind: 'http_status',
          method: 'GET',
          url: 'https://florelle.local/health',
          timeoutMs: 10_000,
          intervalSeconds: 60,
        },
        {
          key: 'postgres',
          label: 'База данных',
          kind: 'http_status',
          method: 'GET',
          url: 'https://florelle.local/health/ready/postgres',
          timeoutMs: 10_000,
          intervalSeconds: 60,
        },
        {
          key: 'redis',
          label: 'Redis',
          kind: 'http_status',
          method: 'GET',
          url: 'https://florelle.local/health/ready/redis',
          timeoutMs: 10_000,
          intervalSeconds: 60,
        },
        {
          key: 'exchange_rate',
          label: 'Курс валюты',
          kind: 'http_status',
          method: 'GET',
          url: 'https://florelle.local/api/v1/currency/rates',
          timeoutMs: 10_000,
          intervalSeconds: 900,
        },
        {
          key: 'visible_catalog',
          label: 'Товары в каталоге',
          kind: 'http_status',
          method: 'GET',
          url: 'https://florelle.local/api/v1/products?limit=1',
          timeoutMs: 10_000,
          intervalSeconds: 900,
        },
      ],
      syntheticScenarios: [],
      actions: [],
      catalog: expect.objectContaining({
        baseUrl: 'https://florelle.local/api/v1/integration/catalog',
        auth: { scheme: 'vv_hmac' },
        categories: expect.objectContaining({
          enabled: true,
          maxDepth: 2,
          fields: ['name', 'slug', 'image', 'sortOrder', 'isActive'],
        }),
        resources: expect.objectContaining({
          products: expect.objectContaining({ enabled: true }),
          offers: expect.objectContaining({
            enabled: true,
            availability: {
              defaultUnit: 'stem',
              units: [{ value: 'stem', label: 'стебель' }],
            },
          }),
          sellers: expect.objectContaining({
            enabled: true,
            mode: 'managed',
            schema: expect.objectContaining({
              required: ['country'],
            }),
          }),
        }),
      }),
    });
    expect(JSON.stringify(service.getManifest())).not.toContain('protocolVersion');
    expect(JSON.stringify(service.getManifest())).not.toContain('vv_hmac_v1');
  });

  it('does not advertise recurring synthetic payments without authoritative cleanup support', () => {
    const service = createService({
      config: buildIntegrationConfig({
        VV_ADMIN_INTEGRATION_SECRET: 'integration-secret',
      }),
    });

    expect(service.getManifest().syntheticScenarios).toEqual([]);
  });

  it('reports live PostgreSQL and Redis failures while preserving disabled dispatch state', async () => {
    const service = createService({
      dbExecute: vi.fn().mockRejectedValue(new Error('database unavailable')),
      redisPing: vi.fn().mockRejectedValue(new Error('redis unavailable')),
    });

    await expect(service.getReadiness()).resolves.toEqual({
      status: 'degraded',
      checks: [
        {
          name: 'postgres',
          status: 'failed',
          message: 'PostgreSQL is unavailable',
        },
        {
          name: 'redis',
          status: 'failed',
          message: 'Redis is unavailable',
        },
        {
          name: 'payment_provider',
          status: 'ok',
          message: 'Payment provider is configured',
        },
        {
          name: 'vv_admin_dispatch',
          status: 'not_configured',
          message: 'VV Admin dispatch is not configured',
        },
      ],
    });
  });

  it('reports ready when dependencies and VV Admin dispatch are configured', async () => {
    const service = createService({
      config: buildIntegrationConfig({
        VV_ADMIN_INTEGRATION_ENABLED: 'true',
        VV_ADMIN_WEBHOOK_URL: 'https://vv-admin.example.com/webhooks/flower-point',
        VV_ADMIN_WEBHOOK_SITE_KEY: 'flower-point',
        VV_ADMIN_WEBHOOK_SECRET: 'webhook-secret',
        VV_ADMIN_WEBHOOK_SECRET_VERSION: 1,
        FLOWER_POINT_INTEGRATION_TOKEN: 'admin-token',
      }),
    });

    await expect(service.getReadiness()).resolves.toEqual({
      status: 'ready',
      checks: [
        {
          name: 'postgres',
          status: 'ok',
          message: 'PostgreSQL is available',
        },
        { name: 'redis', status: 'ok', message: 'Redis is available' },
        {
          name: 'payment_provider',
          status: 'ok',
          message: 'Payment provider is configured',
        },
        {
          name: 'vv_admin_dispatch',
          status: 'ok',
          message: 'VV Admin dispatch is configured',
        },
      ],
    });
  });
});

describe('integration router authorization', () => {
  it.each([
    ['missing token', undefined, 'admin-token'],
    ['invalid token', 'Bearer wrong-token', 'admin-token'],
    ['unconfigured token', 'Bearer admin-token', undefined],
  ])('returns HTTP 401 for %s', async (_caseName, authorization, adminToken) => {
    const app = await buildTestApp(adminToken);

    const response = await app.inject({
      method: 'GET',
      url: '/manifest',
      headers: authorization ? { authorization } : undefined,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: 'UNAUTHORIZED' },
    });
    await app.close();
  });

  it('returns the manifest for a matching bearer token', async () => {
    const app = await buildTestApp('admin-token');

    const response = await app.inject({
      method: 'GET',
      url: '/manifest',
      headers: { authorization: 'Bearer admin-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      site: { key: 'florelle' },
      catalog: expect.objectContaining({
        baseUrl: 'https://florelle.local/api/v1/integration/catalog',
        auth: { scheme: 'vv_hmac' },
      }),
      healthChecks: expect.arrayContaining([
        expect.objectContaining({ key: 'postgres' }),
        expect.objectContaining({ key: 'redis' }),
      ]),
    });
    expect(JSON.stringify(response.json())).not.toContain('protocolVersion');
    await app.close();
  });
});

function createService(overrides?: {
  dbExecute?: ReturnType<typeof vi.fn>;
  redisPing?: ReturnType<typeof vi.fn>;
  config?: ReturnType<typeof buildIntegrationConfig>;
}) {
  return new IntegrationService(
    { execute: overrides?.dbExecute ?? vi.fn().mockResolvedValue([]) },
    { ping: overrides?.redisPing ?? vi.fn().mockResolvedValue('PONG') },
    {},
    overrides?.config ??
      buildIntegrationConfig({
        VV_ADMIN_INTEGRATION_ENABLED: 'false',
        FLOWER_POINT_INTEGRATION_TOKEN: 'admin-token',
      }),
  );
}

async function buildTestApp(adminToken: string | undefined) {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  await app.register(
    buildIntegrationRouter(
      createService(),
      buildIntegrationConfig({
        VV_ADMIN_INTEGRATION_ENABLED: 'false',
        FLOWER_POINT_INTEGRATION_TOKEN: adminToken,
      }),
    ),
  );
  return app;
}
