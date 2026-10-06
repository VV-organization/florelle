import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { CommerceService } from "./commerce.service";
import {
  addCartItemBodySchema,
  updateCartItemBodySchema,
  cartItemParamsSchema,
} from "../orders/orders.schema";
export const checkoutSchema = z.object({
  segment: z.enum(["b2c", "b2b"]),
  displayCurrency: z.enum(["RUB", "KZT", "TRY"]).default("RUB"),
  shippingAddress: z.object({
    address: z.string().trim().min(5).max(500),
    contactName: z.string().trim().min(2).max(200),
    contactPhone: z.string().trim().min(5).max(50),
  }),
  delivery: z.object({
    countryCode: z.enum(["RU", "KZ", "TR"]),
    cityValue: z.string().min(1).max(100),
    mode: z.number().int().min(0).max(2).default(0),
    date: z.string().date(),
    window: z.enum(["09:00–13:00", "13:00–18:00", "18:00–21:00"]),
  }),
  notes: z.string().max(1000).optional(),
});
export function buildCommerceRouter(
  service: CommerceService,
  authenticate: preHandlerAsyncHookHandler,
): FastifyPluginAsync {
  return async (app) => {
    const api = app.withTypeProvider<ZodTypeProvider>();
    api.addHook("preHandler", authenticate);
    api.get(
      "/cart",
      {
        schema: {
          querystring: z.object({
            currency: z.enum(["USD", "RUB", "KZT", "TRY"]).default("RUB"),
            lang: z.enum(["ru", "en"]).default("ru"),
          }),
        },
      },
      (req) =>
        service.getCart(req.user!.id, req.query.currency, req.query.lang),
    );
    api.post(
      "/cart/items",
      { schema: { body: addCartItemBodySchema } },
      async (req, reply) => {
        const item = await service.legacy.addCartItem(req.user!.id, req.body);
        reply.status(201);
        return item;
      },
    );
    api.patch(
      "/cart/items/:id",
      {
        schema: {
          params: cartItemParamsSchema,
          body: updateCartItemBodySchema,
        },
      },
      (req) =>
        service.legacy.updateCartItem(req.user!.id, req.params.id, req.body),
    );
    api.delete(
      "/cart/items/:id",
      { schema: { params: cartItemParamsSchema } },
      async (req, reply) => {
        await service.legacy.removeCartItem(req.user!.id, req.params.id);
        reply.status(204).send();
      },
    );
    api.post("/checkout/quote", { schema: { body: checkoutSchema } }, (req) =>
      service.quote(req.user!.id, req.body),
    );
    api.post(
      "/orders",
      {
        schema: {
          body: checkoutSchema,
          headers: z.object({ "idempotency-key": z.string().min(8).max(128) }),
        },
      },
      async (req, reply) => {
        const result = await service.createOrder(
          req.user!.id,
          req.body,
          req.headers["idempotency-key"],
        );
        reply.status(201);
        return result;
      },
    );
    api.get(
      "/orders",
      {
        schema: {
          querystring: z.object({
            page: z.coerce.number().int().min(1).default(1),
            limit: z.coerce.number().int().min(1).max(100).default(20),
          }),
        },
      },
      (req) =>
        service.listOrders(req.user!.id, req.query.page, req.query.limit),
    );
    api.get(
      "/orders/:id",
      { schema: { params: cartItemParamsSchema } },
      (req) => service.getOrder(req.user!.id, req.params.id),
    );
    api.post(
      "/orders/:id/payment",
      { schema: { params: cartItemParamsSchema } },
      (req) => service.resume(req.user!.id, req.params.id),
    );
  };
}
