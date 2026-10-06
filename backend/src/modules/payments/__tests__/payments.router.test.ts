import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPaymentsRouter } from '../payments.router';
import type { WebhookService } from '../payments.service';

function createWebhookServiceMock(
  result:
    | { handled: boolean; reason?: string }
    | Error,
) {
  return {
    handleCallback:
      result instanceof Error
        ? vi.fn().mockRejectedValue(result)
        : vi.fn().mockResolvedValue(result),
  } as unknown as WebhookService & {
    handleCallback: ReturnType<typeof vi.fn>;
  };
}

describe('payments router', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function injectCallback(
    webhookService: WebhookService,
  ) {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    apps.push(app);
    await app.register(buildPaymentsRouter(webhookService));
    return app.inject({
      method: 'POST',
      url: '/payments/callback',
      headers: {
        'content-type': 'application/json',
        'payment-sign': 'signed-callback',
      },
      payload: { status: 'paid' },
    });
  }

  it('acknowledges a handled callback with HTTP 200', async () => {
    const webhookService = createWebhookServiceMock({ handled: true });

    const response = await injectCallback(webhookService);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
    expect(webhookService.handleCallback).toHaveBeenCalledWith(
      Buffer.from('{"status":"paid"}'),
      'signed-callback',
      { status: 'paid' },
    );
  });

  it.each([
    'invalid_signature',
    'parse_failed',
    'invalid_transition',
    'merchant_order_mismatch',
    'already_processed',
  ])('acknowledges permanent callback result %s with HTTP 200', async (reason) => {
    const webhookService = createWebhookServiceMock({ handled: false, reason });

    const response = await injectCallback(webhookService);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
  });

  it.each([
    'payment_not_found',
    'order_not_found',
    'listing_not_found',
  ])('returns HTTP 503 for retryable callback result %s', async (reason) => {
    const webhookService = createWebhookServiceMock({ handled: false, reason });

    const response = await injectCallback(webhookService);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ success: false });
  });

  it('returns HTTP 503 when callback handling throws', async () => {
    const webhookService = createWebhookServiceMock(
      new Error('database transaction failed'),
    );

    const response = await injectCallback(webhookService);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ success: false });
  });
});
