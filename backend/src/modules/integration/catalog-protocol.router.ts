import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { IntegrationConfig } from './integration.config';
import {
  authenticateCatalogProtocolRequest,
  signedCatalogPathCandidates,
  type CatalogProtocolActor,
} from './catalog-protocol.auth';
import type { CatalogProtocolService } from './catalog-protocol.service';

export function buildCatalogProtocolRouter(
  catalog: CatalogProtocolService,
  config: IntegrationConfig,
): FastifyPluginAsync {
  const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.get('/capabilities', async (request) => {
      authenticate(request, config);
      return catalog.getCapabilities();
    });
    typed.get(
      '/categories',
      { schema: { querystring: listQuery } },
      async (request) => {
        authenticate(request, config);
        return catalog.listCategories(listOptions(request.query));
      },
    );
    typed.get(
      '/products',
      { schema: { querystring: listQuery } },
      async (request) => {
        authenticate(request, config);
        return catalog.listProducts(listOptions(request.query));
      },
    );
    typed.get(
      '/offers',
      { schema: { querystring: listQuery } },
      async (request) => {
        authenticate(request, config);
        return catalog.listOffers(listOptions(request.query));
      },
    );
    typed.get(
      '/sellers',
      { schema: { querystring: listQuery } },
      async (request) => {
        authenticate(request, config);
        return catalog.listSellers(listOptions(request.query));
      },
    );
    typed.post(
      '/sellers',
      { schema: { body: z.unknown() } },
      async (request, reply) => send(reply, await catalog.createSeller(protocolRequest(request, config), request.body)),
    );
    typed.patch(
      '/sellers/:id',
      { schema: { params: idParams, body: z.unknown() } },
      async (request, reply) => send(reply, await catalog.updateSeller(protocolRequest(request, config), request.params.id, request.body)),
    );
    typed.delete(
      '/sellers/:id',
      { schema: { params: idParams, querystring: dryRunQuery } },
      async (request, reply) => send(reply, await catalog.deleteSeller(protocolRequest(request, config), request.params.id, request.query.dryRun)),
    );

    typed.post(
      '/categories',
      { schema: { body: z.unknown() } },
      async (request, reply) => send(reply, await catalog.createCategory(protocolRequest(request, config), request.body)),
    );
    typed.patch(
      '/categories/:id',
      { schema: { params: idParams, body: z.unknown() } },
      async (request, reply) => send(reply, await catalog.updateCategory(protocolRequest(request, config), request.params.id, request.body)),
    );
    typed.delete(
      '/categories/:id',
      { schema: { params: idParams, querystring: dryRunQuery } },
      async (request, reply) => send(reply, await catalog.deleteCategory(protocolRequest(request, config), request.params.id, request.query.dryRun)),
    );

    typed.post(
      '/products',
      { schema: { body: z.unknown() } },
      async (request, reply) => send(reply, await catalog.createProduct(protocolRequest(request, config), request.body)),
    );
    typed.patch(
      '/products/:id',
      { schema: { params: idParams, body: z.unknown() } },
      async (request, reply) => send(reply, await catalog.updateProduct(protocolRequest(request, config), request.params.id, request.body)),
    );
    typed.delete(
      '/products/:id',
      { schema: { params: idParams, querystring: dryRunQuery } },
      async (request, reply) => send(reply, await catalog.deleteProduct(protocolRequest(request, config), request.params.id, request.query.dryRun)),
    );

    typed.post(
      '/offers',
      { schema: { body: z.unknown() } },
      async (request, reply) => send(reply, await catalog.createOffer(protocolRequest(request, config), request.body)),
    );
    typed.patch(
      '/offers/:id',
      { schema: { params: idParams, body: z.unknown() } },
      async (request, reply) => send(reply, await catalog.updateOffer(protocolRequest(request, config), request.params.id, request.body)),
    );
    typed.delete(
      '/offers/:id',
      { schema: { params: idParams, querystring: dryRunQuery } },
      async (request, reply) => send(reply, await catalog.deleteOffer(protocolRequest(request, config), request.params.id, request.query.dryRun)),
    );

    typed.get(
      '/operations/:id',
      { schema: { params: idParams } },
      async (request, reply) => {
        const { actor } = authenticate(request, config);
        const response = await catalog.getOperation(actor.siteKey, request.params.id);
        return send(reply, response);
      },
    );
    typed.get(
      '/operations/by-request/:id',
      { schema: { params: idParams } },
      async (request) => {
        const { actor } = authenticate(request, config);
        return catalog.getOperationByRequest(actor.siteKey, request.params.id);
      },
    );
  };

  return plugin;
}

const idParams = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  cursor: z.string().regex(/^\d+$/).optional(),
});
const dryRunQuery = z.object({
  dryRun: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

function listOptions(query: { limit?: number; cursor?: string }) {
  return {
    limit: query.limit ?? 100,
    cursor: query.cursor ?? null,
  };
}

function protocolRequest(
  request: FastifyRequest,
  config: IntegrationConfig,
) {
  const rawBody = rawProtocolBody(request);
  const { actor, path } = authenticate(request, config, rawBody);
  return {
    actor,
    ifMatch: header(request, 'if-match'),
    method: request.method,
    path,
    rawBody,
  };
}

function authenticate(
  request: FastifyRequest,
  config: IntegrationConfig,
  rawBody = rawProtocolBody(request),
): { actor: CatalogProtocolActor; path: string } {
  let lastError: unknown;
  for (const path of signedCatalogPathCandidates(request.url)) {
    try {
      return {
        actor: authenticateCatalogProtocolRequest(
          {
            headers: request.headers,
            method: request.method,
            path,
            rawBody,
          },
          config.protocolSecret,
        ),
        path,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function rawProtocolBody(request: FastifyRequest): Buffer {
  if (request.body === undefined) return Buffer.alloc(0);
  if (Buffer.isBuffer(request.body)) return request.body;
  if (typeof request.body === 'string') return Buffer.from(request.body);
  return Buffer.from(JSON.stringify(request.body));
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function send(reply: FastifyReply, response: { body: unknown; status: number }) {
  if (response.status >= 400) {
    return reply.status(response.status).type('application/problem+json').send(response.body);
  }
  return reply.status(response.status).send(response.body);
}
