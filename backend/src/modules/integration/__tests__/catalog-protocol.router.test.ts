import { createHash, createHmac, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../../shared/middleware/error.middleware';
import { CatalogProtocolService } from '../catalog-protocol.service';
import { buildIntegrationConfig } from '../integration.config';
import { buildIntegrationRouter } from '../integration.router';

const secret = 'test-vv-admin-integration-secret';

describe('catalog protocol router', () => {
  it('rejects unsigned catalog requests before dispatch', async () => {
    const catalog = { listProducts: vi.fn() };
    const app = await buildTestApp(catalog);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/integration/catalog/products',
    });

    expect(response.statusCode).toBe(401);
    expect(catalog.listProducts).not.toHaveBeenCalled();
    await app.close();
  });

  it('accepts VV Admin signed relative resource paths', async () => {
    const catalog = {
      listProducts: vi.fn().mockResolvedValue({
        items: [{ id: 'product-1', revision: '1' }],
        nextCursor: null,
      }),
    };
    const app = await buildTestApp(catalog);
    const path = '/products';

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/integration/catalog/products',
      headers: signedHeaders('GET', path),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [{ id: 'product-1', revision: '1' }],
      nextCursor: null,
    });
    expect(catalog.listProducts).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('passes list pagination parameters to the catalog service', async () => {
    const catalog = {
      listProducts: vi.fn().mockResolvedValue({
        items: [{ id: 'product-2', revision: '2' }],
        nextCursor: null,
      }),
    };
    const app = await buildTestApp(catalog);
    const path = '/products?limit=100&cursor=2';

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/integration/catalog/products?limit=100&cursor=2',
      headers: signedHeaders('GET', path),
    });

    expect(response.statusCode).toBe(200);
    expect(catalog.listProducts).toHaveBeenCalledWith({
      limit: 100,
      cursor: '2',
    });
    await app.close();
  });

  it('dispatches signed seller creation requests', async () => {
    const body = JSON.stringify({
      title: { ru: 'Поставщик' },
      slug: 'seller',
      image: null,
      isActive: true,
      attributes: { country: 'NL' },
    });
    const catalog = {
      createSeller: vi.fn().mockResolvedValue({
        status: 201,
        body: {
          resource: {
            id: '00000000-0000-0000-0000-000000000001',
            revision: '1',
          },
        },
      }),
    };
    const app = await buildTestApp(catalog);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/integration/catalog/sellers',
      headers: {
        ...signedHeaders('POST', '/sellers', body),
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      payload: body,
    });

    expect(response.statusCode).toBe(201);
    expect(catalog.createSeller).toHaveBeenCalledTimes(1);
    expect(catalog.createSeller.mock.calls[0]?.[1]).toEqual({
      title: { ru: 'Поставщик' },
      slug: 'seller',
      image: null,
      isActive: true,
      attributes: { country: 'NL' },
    });
    await app.close();
  });
});

describe('catalog protocol service pagination', () => {
  it('returns a bounded category page with a follow-up cursor', async () => {
    const rows = [
      categoryRow('category-1'),
      categoryRow('category-2'),
      categoryRow('category-3'),
    ];
    const orderBy = vi.fn().mockResolvedValue(rows);
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({ orderBy })),
      })),
    };
    const service = new CatalogProtocolService(db as never);

    await expect(
      service.listCategories({ limit: 2, cursor: '0' }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({ id: 'category-1' }),
        expect.objectContaining({ id: 'category-2' }),
      ],
      nextCursor: '2',
    });
  });

  it('returns the current revision in seller deletion dry-run preview', async () => {
    const now = new Date('2026-08-18T00:00:00.000Z');
    const seller = {
      id: 'seller-1',
      name: { ru: 'Поставщик' },
      slug: 'seller',
      logoUrl: null,
      country: 'EC',
      rating: 49,
      verified: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    const request = {
      actor: {
        actorId: 'operator-1',
        idempotencyKey: 'seller-delete-preview-1',
        requestId: randomUUID(),
        siteKey: 'florelle',
      },
      ifMatch: String(now.getTime()),
      method: 'DELETE',
      path: '/sellers/seller-1?dryRun=true',
      rawBody: Buffer.from(''),
    };
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          method: request.method,
          path: request.path,
          body: '',
        }),
      )
      .digest('hex');
    const operation = {
      id: 'operation-1',
      state: 'in_progress',
      requestFingerprint: fingerprint,
    };
    const tx = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([operation]),
          })),
        })),
      })),
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([seller]),
            })),
          })),
        })
        .mockReturnValueOnce({
          from: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([]),
          })),
        }),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(undefined),
        })),
      })),
    };
    const db = {
      transaction: vi.fn((callback) => callback(tx)),
    };
    const service = new CatalogProtocolService(db as never);

    await expect(service.deleteSeller(request, 'seller-1', true)).resolves.toEqual({
      status: 200,
      body: {
        operationId: 'operation-1',
        resource: expect.objectContaining({
          id: 'seller-1',
          revision: String(now.getTime()),
          dryRun: true,
        }),
      },
    });
  });
});

async function buildTestApp(catalog: Record<string, unknown>) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  await app.register(
    buildIntegrationRouter(
      { getManifest: vi.fn(), getReadiness: vi.fn() } as never,
      buildIntegrationConfig({ VV_ADMIN_INTEGRATION_SECRET: secret }),
      {
        getCapabilities: vi.fn(),
        listCategories: vi.fn(),
        listProducts: vi.fn(),
        listOffers: vi.fn(),
        listSellers: vi.fn(),
        createSeller: vi.fn(),
        updateSeller: vi.fn(),
        deleteSeller: vi.fn(),
        createCategory: vi.fn(),
        updateCategory: vi.fn(),
        deleteCategory: vi.fn(),
        createProduct: vi.fn(),
        updateProduct: vi.fn(),
        deleteProduct: vi.fn(),
        createOffer: vi.fn(),
        updateOffer: vi.fn(),
        deleteOffer: vi.fn(),
        getOperation: vi.fn(),
        getOperationByRequest: vi.fn(),
        ...catalog,
      } as never,
    ),
    { prefix: '/api/v1/integration' },
  );
  return app;
}

function signedHeaders(method: string, path: string, body = '') {
  const timestamp = new Date().toISOString();
  const requestId = randomUUID();
  const digest = createHash('sha256').update(body).digest('hex');
  const canonical = `vv-admin.${timestamp}.${requestId}.${method}.${path}.${digest}`;
  return {
    'x-vv-actor-id': 'operator-1',
    'x-vv-request-id': requestId,
    'x-vv-signature': `sha256=${createHmac('sha256', secret)
      .update(canonical)
      .digest('hex')}`,
    'x-vv-site-key': 'florelle',
    'x-vv-timestamp': timestamp,
  };
}

function categoryRow(id: string) {
  return {
    id,
    parentId: null,
    name: id,
    slug: id,
    imageUrl: null,
    sortOrder: 0,
    isActive: true,
    createdAt: new Date('2026-08-18T00:00:00.000Z'),
    updatedAt: new Date('2026-08-18T00:00:00.000Z'),
  };
}
