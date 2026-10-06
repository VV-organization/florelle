import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { OrdersService } from './orders.service';
import {
  addCartItemBodySchema,
  cartItemParamsSchema,
  cartQuerySchema,
  cartItemResponseSchema,
  cartResponseSchema,
  createOrderBodySchema,
  createOrderResponseSchema,
  orderIdParamsSchema,
  orderDetailSchema,
  ordersListQuerySchema,
  ordersListResponseSchema,
  updateCartItemBodySchema,
} from './orders.schema';

export function buildOrdersRouter(
  ordersService: OrdersService,
  options: { authenticate: FastifyInstance['authenticate'] },
): FastifyPluginAsync {
  const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    // Cart routes

    typed.post(
      '/cart/items',
      {
        preHandler: [options.authenticate],
        schema: {
          tags: ['cart'],
          body: addCartItemBodySchema,
          response: { 201: cartItemResponseSchema },
        },
      },
      async (request, reply) => {
        const result = await ordersService.addCartItem(
          request.user!.id,
          request.body,
        );
        reply.status(201);
        return result;
      },
    );

    typed.get(
      '/cart',
      {
        preHandler: [options.authenticate],
        schema: {
          tags: ['cart'],
          querystring: cartQuerySchema,
          response: { 200: cartResponseSchema },
        },
      },
      async (request) => {
        return ordersService.getCart(
          request.user!.id,
          request.query.currency,
          request.query.lang,
        );
      },
    );

    typed.patch(
      '/cart/items/:id',
      {
        preHandler: [options.authenticate],
        schema: {
          tags: ['cart'],
          params: cartItemParamsSchema,
          body: updateCartItemBodySchema,
          response: { 200: cartItemResponseSchema },
        },
      },
      async (request) => {
        return ordersService.updateCartItem(
          request.user!.id,
          request.params.id,
          request.body,
        );
      },
    );

    typed.delete(
      '/cart/items/:id',
      {
        preHandler: [options.authenticate],
        schema: {
          tags: ['cart'],
          params: cartItemParamsSchema,
        },
      },
      async (request, reply) => {
        await ordersService.removeCartItem(request.user!.id, request.params.id);
        reply.status(204);
        return;
      },
    );

    // Order routes

    typed.post(
      '/orders',
      {
        preHandler: [options.authenticate],
        schema: {
          tags: ['orders'],
          body: createOrderBodySchema,
          response: { 201: createOrderResponseSchema },
        },
      },
      async (request, reply) => {
        const result = await ordersService.createOrder(
          request.user!.id,
          request.body,
        );
        reply.status(201);
        return result;
      },
    );

    typed.get(
      '/orders',
      {
        preHandler: [options.authenticate],
        schema: {
          tags: ['orders'],
          querystring: ordersListQuerySchema,
          response: { 200: ordersListResponseSchema },
        },
      },
      async (request) => {
        return ordersService.listOrders(
          request.user!.id,
          request.query.page,
          request.query.limit,
        );
      },
    );

    typed.get(
      '/orders/:id',
      {
        preHandler: [options.authenticate],
        schema: {
          tags: ['orders'],
          params: orderIdParamsSchema,
          response: { 200: orderDetailSchema },
        },
      },
      async (request) => {
        return ordersService.getOrderById(request.user!.id, request.params.id);
      },
    );
  };

  return plugin;
}
