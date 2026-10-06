import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { BalanceService } from './balance.service';
import {
  balanceResponseSchema,
  balanceTransactionsResponseSchema,
  createTopUpBodySchema,
  createTopUpResponseSchema,
  topUpIdParamsSchema,
  topUpResponseSchema,
  topUpsListResponseSchema,
} from './balance.schema';

export function buildBalanceRouter(
  balanceService: BalanceService,
  options: { authenticate: FastifyInstance['authenticate'] },
): FastifyPluginAsync {
  const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.get(
      '/balance',
      {
        preHandler: [options.authenticate],
        schema: {
          tags: ['balance'],
          response: { 200: balanceResponseSchema },
        },
      },
      async (request) => balanceService.getBalance(request.user!.id),
    );

    typed.get(
      '/balance/transactions',
      {
        preHandler: [options.authenticate],
        schema: {
          tags: ['balance'],
          response: { 200: balanceTransactionsResponseSchema },
        },
      },
      async (request) => balanceService.listTransactions(request.user!.id),
    );

    typed.post(
      '/top-ups',
      {
        preHandler: [options.authenticate],
        schema: {
          tags: ['balance'],
          body: createTopUpBodySchema,
          response: { 201: createTopUpResponseSchema },
        },
      },
      async (request, reply) => {
        const result = await balanceService.createTopUp(
          request.user!.id,
          request.body,
        );
        reply.status(201);
        return result;
      },
    );

    typed.get(
      '/top-ups',
      {
        preHandler: [options.authenticate],
        schema: {
          tags: ['balance'],
          response: { 200: topUpsListResponseSchema },
        },
      },
      async (request) => balanceService.listTopUps(request.user!.id),
    );

    typed.post(
      '/top-ups/:id/pay',
      {
        preHandler: [options.authenticate],
        schema: {
          tags: ['balance'],
          params: topUpIdParamsSchema,
          response: { 200: createTopUpResponseSchema },
        },
      },
      async (request) => (
        balanceService.getTopUpPaymentUrl(request.params.id, request.user!.id)
      ),
    );

    typed.post(
      '/top-ups/:id/cancel',
      {
        preHandler: [options.authenticate],
        schema: {
          tags: ['balance'],
          params: topUpIdParamsSchema,
          response: { 200: topUpResponseSchema },
        },
      },
      async (request) => (
        balanceService.cancelTopUp(request.params.id, request.user!.id)
      ),
    );
  };

  return plugin;
}
