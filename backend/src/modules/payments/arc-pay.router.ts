import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { verifyArcPayWebhook } from "./arc-pay-client";
import type { ArcPayService } from "./arc-pay.service";
export function buildArcPayRouter(
  service: Pick<ArcPayService, "receive">,
  secret: string,
): FastifyPluginAsync {
  return async (app) => {
    app.addContentTypeParser(
      "application/json",
      { parseAs: "buffer", bodyLimit: 65536 },
      (_req, body, done) => done(null, body),
    );
    app.post(
      "/payments/webhooks/arc-pay",
      { bodyLimit: 65536 },
      async (req, reply) => {
        const raw = req.body;
        if (
          !Buffer.isBuffer(raw) ||
          !verifyArcPayWebhook(raw, req.headers, secret)
        )
          return reply.code(401).send({ success: false });
        let body: unknown;
        try {
          body = JSON.parse(raw.toString("utf8"));
        } catch {
          return reply.code(400).send({ success: false });
        }
        try {
          await service.receive(req.headers["webhook-id"] as string, body);
          return { success: true };
        } catch (error) {
          if (
            error instanceof z.ZodError ||
            (error instanceof Error &&
              error.message === "ARC_EVENT_PAYMENT_MISSING")
          )
            return reply.code(400).send({ success: false });
          // Do not put event bodies, signatures or secrets into application logs.
          req.log.error(
            { eventId: req.headers["webhook-id"] },
            "Arc Pay event could not be persisted",
          );
          return reply.code(503).send({ success: false });
        }
      },
    );
  };
}
