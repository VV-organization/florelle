import { randomUUID } from 'node:crypto';
import type {
  CreatePaymentParams,
  CreatePaymentResult,
  PaymentUrlParams,
  PaymentProvider,
  WebhookPayload,
} from './payment-provider';

/**
 * MockPaymentProvider — zero-dependency stub for development and testing.
 *
 * createPayment returns a fake externalId + paymentUrl.
 * verifyWebhookSignature always returns true.
 * parseWebhookPayload accepts a simple { merchantOrderId, externalId, status }
 * body shape.
 *
 * Replace with ArcoPayPaymentProvider in app.ts when ready to integrate.
 */
export class MockPaymentProvider implements PaymentProvider {
  async createPayment(
    params: CreatePaymentParams,
  ): Promise<CreatePaymentResult> {
    return {
      externalId: `mock-${randomUUID()}`,
      paymentUrl: `https://mock-pay.example.com/${params.merchantOrderId}`,
    };
  }

  async getPaymentUrl(
    params: PaymentUrlParams,
  ): Promise<{ paymentUrl: string }> {
    return {
      paymentUrl: `https://mock-pay.example.com/${params.externalId}`,
    };
  }

  verifyWebhookSignature(_rawBody: Buffer, _signature: string): boolean {
    return true;
  }

  parseWebhookPayload(body: unknown): WebhookPayload {
    const data = (body ?? {}) as Record<string, unknown>;
    const status = data.status === 'paid' ? 'paid' : 'failed';
    return {
      merchantOrderId: String(data.merchantOrderId ?? ''),
      externalId: String(data.externalId ?? ''),
      status,
    };
  }
}
