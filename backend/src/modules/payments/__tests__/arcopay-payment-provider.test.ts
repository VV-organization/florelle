import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ArcopayPaymentProvider } from '../arcopay-payment-provider';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Gateway',
    json: () => Promise.resolve(body),
  } as Response;
}

describe('ArcopayPaymentProvider', () => {
  it('aborts a provider request that exceeds the configured timeout', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) => new Promise((_resolve, reject) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      }),
    );
    const provider = new ArcopayPaymentProvider({
      apiUrl: 'https://api.mapsign.pro/api/v1',
      apiKey: 'api-key',
      bearerToken: 'bearer-token',
      publicKey: 'unused',
      fetchFn,
      requestTimeoutMs: 10,
      convertUsdToRub: vi.fn().mockResolvedValue('50.34'),
    });

    await expect(provider.createPayment({
      merchantOrderId: 'FL-20260713-TIMEOUT',
      amountUsd: '0.70',
      description: 'Flowers order timeout',
      callbackUrl: 'https://flowers.example.com/api/v1/payments/callback',
    })).rejects.toMatchObject({ name: 'TimeoutError' });

    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('creates an IPS order and returns NSPK payment link', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          Response: { Success: true },
          Order: {
            OrderId: '60fbe28e-3219-448c-b792-7f6a49fe1d39',
            MerchantOrderId: 'FL-20260611-TEST01',
            Amount: 5034,
            Currency: 'RUB',
            Status: 'CREATED',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          Response: { Success: true },
          Order: {
            OrderId: '60fbe28e-3219-448c-b792-7f6a49fe1d39',
            MerchantOrderId: 'FL-20260611-TEST01',
            Amount: 5034,
            Currency: 'RUB',
            Status: 'QRCDATA_CREATED',
          },
          Qrc: {
            QrcId: randomUUID(),
            Payload: 'https://qr.nspk.ru/AD10000TEST',
          },
        }),
      );

    const provider = new ArcopayPaymentProvider({
      apiUrl: 'https://api.mapsign.pro/api/v1',
      apiKey: 'api-key',
      bearerToken: 'bearer-token',
      publicKey: 'unused',
      fetchFn,
      convertUsdToRub: vi.fn().mockResolvedValue('50.34'),
    });

    const result = await provider.createPayment({
      merchantOrderId: 'FL-20260611-TEST01',
      amountUsd: '0.70',
      description: 'Flowers order order-id',
      buyerEmail: 'buyer@example.com',
      buyerPhone: '+79990000000',
      callbackUrl: 'https://flowers.example.com/api/v1/payments/callback',
      successUrl: 'https://flowers.example.com/orders/order-id/success',
      failUrl: 'https://flowers.example.com/orders/order-id/fail',
    });

    expect(result).toEqual({
      externalId: '60fbe28e-3219-448c-b792-7f6a49fe1d39',
      paymentUrl: 'https://qr.nspk.ru/AD10000TEST',
    });
    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      'https://api.mapsign.pro/api/v1/payments/create',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: 'Bearer bearer-token',
          'Content-Type': 'application/json',
          'x-api-key': 'api-key',
        }),
        body: JSON.stringify({
          MerchantOrderId: 'FL-20260611-TEST01',
          Currency: 'RUB',
          Type: 'PayIn',
          PaymentTypes: ['IPS'],
          Amount: 5034,
          FiscalData: { FiscalEnabled: false },
          Buyer: { Email: 'buyer@example.com', Phone: '+79990000000' },
          CallbackUrl: 'https://flowers.example.com/api/v1/payments/callback',
          IsForm: false,
          LifeTime: 1800,
        }),
      }),
    );
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      'https://api.mapsign.pro/api/v1/payments/ips/qrcData',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          OrderId: '60fbe28e-3219-448c-b792-7f6a49fe1d39',
          QrcType: '02',
          TemplateVersion: '01',
          QrTtl: '15',
          Description: 'Flowers order order-id',
          PhoneNumber: '+79990000000',
        }),
      }),
    );
  });

  it('refreshes IPS QR data for an existing Arcopay order', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        Response: { Success: true },
        Order: {
          OrderId: 'arcopay-order-id',
          MerchantOrderId: 'TU-20260624-ABC123',
          Amount: 890000,
          Currency: 'RUB',
          Status: 'QRCDATA_CREATED',
        },
        Qrc: {
          QrcId: randomUUID(),
          Payload: 'https://qr.nspk.ru/BD10000REFRESH',
        },
      }),
    );

    const provider = new ArcopayPaymentProvider({
      apiUrl: 'https://api.arcopay.tech/api/v1',
      apiKey: 'api-key',
      bearerToken: 'bearer-token',
      publicKey: 'unused',
      fetchFn,
      convertUsdToRub: vi.fn(),
    });

    const result = await provider.getPaymentUrl({
      externalId: 'arcopay-order-id',
      description: 'Balance top-up TU-20260624-ABC123',
      buyerPhone: '+79990000000',
    });

    expect(result.paymentUrl).toBe('https://qr.nspk.ru/BD10000REFRESH');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.arcopay.tech/api/v1/payments/ips/qrcData',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          OrderId: 'arcopay-order-id',
          QrcType: '02',
          TemplateVersion: '01',
          QrTtl: '15',
          Description: 'Balance top-up TU-20260624-ABC123',
          PhoneNumber: '+79990000000',
        }),
      }),
    );
  });

  it('maps Arcopay callback statuses without treating intermediate statuses as failures', () => {
    const provider = new ArcopayPaymentProvider({
      apiUrl: 'https://api.mapsign.pro/api/v1',
      apiKey: 'api-key',
      bearerToken: 'bearer-token',
      publicKey: 'unused',
      fetchFn: vi.fn<typeof fetch>(),
      convertUsdToRub: vi.fn(),
    });

    expect(
      provider.parseWebhookPayload({
        Response: { Success: true },
        Order: {
          OrderId: 'arcopay-order-id',
          MerchantOrderId: 'FL-20260611-TEST01',
          Amount: 5034,
          Currency: 'RUB',
          Status: 'IPS_ACCEPTED',
        },
      }).status,
    ).toBe('paid');

    expect(
      provider.parseWebhookPayload({
        Response: { Success: false },
        Order: {
          OrderId: 'arcopay-order-id',
          MerchantOrderId: 'FL-20260611-TEST01',
          Amount: 5034,
          Currency: 'RUB',
          Status: 'DECLINED',
        },
      }).status,
    ).toBe('failed');

    expect(
      provider.parseWebhookPayload({
        Response: { Success: true },
        Order: {
          OrderId: 'arcopay-order-id',
          MerchantOrderId: 'FL-20260611-TEST01',
          Amount: 5034,
          Currency: 'RUB',
          Status: 'QRCDATA_CREATED',
        },
      }),
    ).toEqual({
      merchantOrderId: 'FL-20260611-TEST01',
      externalId: 'arcopay-order-id',
      status: 'pending',
      amountMinor:5034,
      currency:'RUB',
    });
  });

  it('verifies callbacks when PEM public key is provided with escaped newlines', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const rawBody = Buffer.from('{"ok":true}');
    const signature = createSign('RSA-SHA1')
      .update(rawBody)
      .end()
      .sign(privateKey, 'base64');

    const provider = new ArcopayPaymentProvider({
      apiUrl: 'https://api.mapsign.pro/api/v1',
      apiKey: 'api-key',
      bearerToken: 'bearer-token',
      publicKey: publicKey
        .export({ type: 'spki', format: 'pem' })
        .toString()
        .replace(/\n/g, '\\n'),
      fetchFn: vi.fn<typeof fetch>(),
      convertUsdToRub: vi.fn(),
    });

    expect(provider.verifyWebhookSignature(rawBody, signature)).toBe(true);
  });
});
