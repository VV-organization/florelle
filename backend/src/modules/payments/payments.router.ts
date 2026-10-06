import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { WebhookService } from './payments.service';

interface WebhookRequest extends FastifyRequest {
  rawBody?: Buffer;
}

type WebhookResult = Awaited<ReturnType<WebhookService['handleCallback']>>;

const acknowledgedResponseSchema = z.object({ success: z.literal(true) });
const retryResponseSchema = z.object({ success: z.literal(false) });

function classifyWebhookResult(
  result: WebhookResult,
): 'acknowledge' | 'retry' {
  if (result.handled) return 'acknowledge';

  switch (result.reason) {
    case 'invalid_signature':
    case 'parse_failed':
    case 'invalid_transition':
    case 'merchant_order_mismatch':
    case 'payment_amount_mismatch':
    case 'already_processed':
      return 'acknowledge';
    case 'payment_not_found':
    case 'order_not_found':
    case 'listing_not_found':
    default:
      return 'retry';
  }
}

export function buildPaymentsRouter(
  webhookService: WebhookService,
): FastifyPluginAsync {
  const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    // Content-type parser that captures raw body for signature verification.
    // Scoped to this plugin so it does not affect other routes.
    app.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (req, body, done) => {
        try {
          (req as unknown as WebhookRequest).rawBody = body as Buffer;
          const parsed = JSON.parse((body as Buffer).toString());
          done(null, parsed);
        } catch (err) {
          done(err as Error);
        }
      },
    );

    typed.post(
      '/payments/callback',
      {
        schema: {
          tags: ['payments'],
          response: {
            200: acknowledgedResponseSchema,
            503: retryResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const typedReq = request as WebhookRequest;
        const signature = (request.headers['payment-sign'] as string) ?? '';
        const rawBody = typedReq.rawBody ?? Buffer.from('');

        try {
          const result = await webhookService.handleCallback(
            rawBody,
            signature,
            request.body,
          );
          if (classifyWebhookResult(result) === 'retry') {
            request.log.warn(
              { reason: result.reason },
              'payment webhook not handled; requesting retry',
            );
            reply.status(503);
            return { success: false as const };
          }
          if (!result.handled) {
            request.log.warn(
              { reason: result.reason },
              'payment webhook permanently rejected',
            );
          }
          reply.status(200);
          return { success: true as const };
        } catch (err) {
          request.log.error({ err }, 'payment webhook handler threw');
          reply.status(503);
          return { success: false as const };
        }
      },
    );
  };

  return plugin;
}
