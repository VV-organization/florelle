import { describe, expect, it } from 'vitest';
import { MockPaymentProvider } from '../mock-payment-provider';

describe('MockPaymentProvider', () => {
  const provider = new MockPaymentProvider();

  it('createPayment returns mock externalId and paymentUrl', async () => {
    const result = await provider.createPayment({
      merchantOrderId: 'FL-20260410-A1B2C3D4',
      amountUsd: '98.00',
      description: 'Test order',
      callbackUrl: 'http://localhost/callback',
      successUrl: 'http://localhost/success',
      failUrl: 'http://localhost/fail',
    });

    expect(result.externalId).toMatch(/^mock-[0-9a-f-]{36}$/);
    expect(result.paymentUrl).toBe(
      'https://mock-pay.example.com/FL-20260410-A1B2C3D4',
    );
  });

  it('getPaymentUrl returns a mock paymentUrl for an existing externalId', async () => {
    await expect(
      provider.getPaymentUrl({
        externalId: 'mock-existing-order',
        description: 'Existing test order',
      }),
    ).resolves.toEqual({
      paymentUrl: 'https://mock-pay.example.com/mock-existing-order',
    });
  });

  it('verifyWebhookSignature always returns true', () => {
    expect(provider.verifyWebhookSignature(Buffer.from(''), '')).toBe(true);
    expect(provider.verifyWebhookSignature(Buffer.from('anything'), 'sig')).toBe(true);
  });

  it('parseWebhookPayload maps paid and failed statuses', () => {
    const paid = provider.parseWebhookPayload({
      merchantOrderId: 'FL-20260410-A1B2C3D4',
      externalId: 'mock-abc',
      status: 'paid',
    });
    expect(paid).toEqual({
      merchantOrderId: 'FL-20260410-A1B2C3D4',
      externalId: 'mock-abc',
      status: 'paid',
    });

    const failed = provider.parseWebhookPayload({
      merchantOrderId: 'FL-20260410-A1B2C3D4',
      externalId: 'mock-abc',
      status: 'failed',
    });
    expect(failed.status).toBe('failed');

    // Anything other than 'paid' maps to 'failed'
    const unknown = provider.parseWebhookPayload({
      merchantOrderId: 'x',
      externalId: 'y',
      status: 'whatever',
    });
    expect(unknown.status).toBe('failed');
  });
});
