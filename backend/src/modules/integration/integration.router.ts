import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authorizeIntegrationRequest } from './integration.auth';
import type { IntegrationConfig } from './integration.config';
import {
  integrationManifestSchema,
  integrationReadinessSchema,
  integrationScenarioRunRequestSchema,
  integrationScenarioResultSchema,
} from './integration.schema';
import type { IntegrationService } from './integration.service';
import {
  canonicalScenarioRequestBody,
  isAuthorizedVvAdminScenarioRequest,
} from './vv-admin-scenario-auth';
import { buildCatalogProtocolRouter } from './catalog-protocol.router';
import type { CatalogProtocolService } from './catalog-protocol.service';

export function buildIntegrationRouter(
  integrationService: IntegrationService,
  config: IntegrationConfig,
  catalogProtocolService?: CatalogProtocolService,
): FastifyPluginAsync {
  const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.get(
      '/manifest',
      {
        schema: {
          tags: ['integration'],
          response: { 200: integrationManifestSchema },
        },
      },
      async (request) => {
        authorizeIntegrationRequest(
          request.headers.authorization,
          config.adminToken,
        );
        return integrationManifestSchema.parse(integrationService.getManifest());
      },
    );

    typed.get(
      '/readiness',
      {
        schema: {
          tags: ['integration'],
          response: { 200: integrationReadinessSchema },
        },
      },
      async (request) => {
        authorizeIntegrationRequest(
          request.headers.authorization,
          config.adminToken,
        );
        return integrationService.getReadiness();
      },
    );

    typed.post(
      '/scenarios/checkout-payment-reached/run',
      {
        schema: {
          tags: ['integration'],
          body: integrationScenarioRunRequestSchema,
          response: {
            200: integrationScenarioResultSchema,
            401: z.object({ error: z.literal('scenario_authorization_invalid') }),
          },
        },
      },
      async (request, reply) => {
        const requestPath = request.raw.url ?? '';
        const authorized = isAuthorizedVvAdminScenarioRequest({
          secret: config.protocolSecret,
          signature: request.headers['x-vv-admin-signature'],
          timestamp: request.headers['x-vv-admin-timestamp'],
          path: requestPath,
          body: canonicalScenarioRequestBody(request.body),
        });
        if (!authorized) {
          return reply.status(401).send({ error: 'scenario_authorization_invalid' });
        }

        return integrationService.runCheckoutPaymentReachedScenario({
          scenarioRunId: request.body.runId,
        });
      },
    );

    if (catalogProtocolService) {
      await app.register(buildCatalogProtocolRouter(catalogProtocolService, config), {
        prefix: '/catalog',
      });
    }
  };

  return plugin;
}
