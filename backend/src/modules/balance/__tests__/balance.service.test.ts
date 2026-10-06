import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../shared/db/client';
import type { FxService } from '../../../shared/currency/fx.service';
import type { PaymentProvider } from '../../payments/payment-provider';
import { BalanceService, type BalanceServiceConfig } from '../balance.service';

function createDbMock() {
  const db = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(db)),
    for: vi.fn(),
  };

  return db as unknown as Database & typeof db;
}

function createFxMock(): FxService & { getRate: ReturnType<typeof vi.fn> } {
  return {
    getRate: vi.fn().mockResolvedValue(89),
  } as unknown as FxService & { getRate: ReturnType<typeof vi.fn> };
}

function createPaymentProviderMock(): PaymentProvider & {
  createPayment: ReturnType<typeof vi.fn>;
  getPaymentUrl: ReturnType<typeof vi.fn>;
} {
  return {
    createPayment: vi.fn().mockResolvedValue({
      externalId: 'arcopay-order-id',
      paymentUrl: 'https://qr.nspk.ru/top-up',
    }),
    getPaymentUrl: vi.fn().mockResolvedValue({
      paymentUrl: 'https://qr.nspk.ru/refreshed',
    }),
    verifyWebhookSignature: vi.fn(),
    parseWebhookPayload: vi.fn(),
  } as unknown as PaymentProvider & {
    createPayment: ReturnType<typeof vi.fn>;
    getPaymentUrl: ReturnType<typeof vi.fn>;
  };
}

const config: BalanceServiceConfig = {
  callbackUrl: 'https://flower-point.com/api/v1/payments/callback',
};

const userId = '00000000-0000-0000-0000-000000000001';
const topUpId = '00000000-0000-0000-0000-000000000010';
const merchantOrderId = 'TU-20260624-ABC123';
const createdAt = new Date('2026-06-24T00:00:00Z');
const paidAt = new Date('2026-06-24T00:01:00Z');

function topUpRow(overrides: Record<string, unknown> = {}) {
  return {
    id: topUpId,
    userId,
    merchantOrderId,
    arcopayOrderId: 'arcopay-order-id',
    amountUsd: '100.00',
    amountRub: '8900.00',
    fxRate: '89.000000',
    status: 'pending',
    paymentUrl: 'https://qr.nspk.ru/top-up',
    buyerEmail: 'buyer@example.com',
    buyerPhone: '+79991234567',
    paidAt: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

describe('BalanceService', () => {
  let db: ReturnType<typeof createDbMock>;
  let fx: ReturnType<typeof createFxMock>;
  let paymentProvider: ReturnType<typeof createPaymentProviderMock>;
  let service: BalanceService;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createDbMock();
    fx = createFxMock();
    paymentProvider = createPaymentProviderMock();
    service = new BalanceService(db, fx, paymentProvider, config);
  });

  it('creates a pending USD top-up and ArcPay SBP QR in RUB', async () => {
    db.limit.mockResolvedValueOnce([{ id: userId, email: 'buyer@example.com' }]);
    db.returning
      .mockResolvedValueOnce([topUpRow({ arcopayOrderId: null, paymentUrl: null })])
      .mockResolvedValueOnce([topUpRow()]);

    const result = await service.createTopUp(userId, {
      amountUsd: '100.00',
      buyerEmail: 'buyer@example.com',
      buyerPhone: '+79991234567',
    });

    expect(fx.getRate).toHaveBeenCalledWith('RUB');
    expect(db.values).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId,
        amountUsd: '100.00',
        amountRub: '8900.00',
        fxRate: '89.000000',
        buyerEmail: 'buyer@example.com',
        buyerPhone: '+79991234567',
        status: 'pending',
      }),
    );
    expect(paymentProvider.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantOrderId: expect.stringMatching(/^TU-\d{8}-[A-Z0-9]{6}$/),
        amountUsd: '100.00',
        description: expect.stringMatching(/^Balance top-up TU-\d{8}-[A-Z0-9]{6}$/),
        buyerEmail: 'buyer@example.com',
        buyerPhone: '+79991234567',
        callbackUrl: config.callbackUrl,
      }),
    );
    expect(result).toEqual({
      topUp: {
        id: topUpId,
        status: 'pending',
        amountUsd: '100.00',
        amountRub: '8900.00',
        fxRate: '89.000000',
        merchantOrderId,
        paymentUrl: 'https://qr.nspk.ru/top-up',
        createdAt: '2026-06-24T00:00:00.000Z',
        paidAt: null,
      },
      paymentUrl: 'https://qr.nspk.ru/top-up',
    });
  });

  it('credits balance once for a paid top-up callback', async () => {
    db.for
      .mockResolvedValueOnce([topUpRow({ paymentUrl: null, paidAt: null })])
      .mockResolvedValueOnce([{ id: userId, balanceUsd: '25.00' }]);
    db.returning.mockResolvedValueOnce([topUpRow({ status: 'completed', paidAt })]);

    const result = await service.processTopUpCallback({
      merchantOrderId,
      externalId: 'arcopay-order-id',
      status: 'paid',
    });

    expect(result).toEqual({ handled: true, reason: 'top_up_completed' });
    expect(db.transaction).toHaveBeenCalled();
    expect(db.for).toHaveBeenCalledTimes(2);
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        arcopayOrderId: 'arcopay-order-id',
      }),
    );
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        type: 'top_up',
        amountUsd: '100.00',
        balanceAfterUsd: '125.00',
        topUpId,
      }),
    );
  });

  it('does not double-credit completed top-ups', async () => {
    db.for.mockResolvedValueOnce([topUpRow({ status: 'completed', paidAt })]);

    const result = await service.processTopUpCallback({
      merchantOrderId,
      externalId: 'arcopay-order-id',
      status: 'paid',
    });

    expect(result).toEqual({ handled: true, reason: 'top_up_already_completed' });
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.set).not.toHaveBeenCalled();
  });

  it('marks pending top-up failed on failed callback', async () => {
    db.for.mockResolvedValueOnce([topUpRow({ status: 'pending' })]);

    const result = await service.processTopUpCallback({
      merchantOrderId,
      externalId: 'arcopay-order-id',
      status: 'failed',
    });

    expect(result).toEqual({ handled: true, reason: 'top_up_failed' });
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        arcopayOrderId: 'arcopay-order-id',
      }),
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('keeps existing ArcPay order id and does not credit balance on pending callback', async () => {
    db.for.mockResolvedValueOnce([
      topUpRow({
        status: 'pending',
        arcopayOrderId: 'existing-arcopay-order-id',
      }),
    ]);

    const result = await service.processTopUpCallback({
      merchantOrderId,
      externalId: 'new-arcopay-order-id',
      status: 'pending',
    });

    expect(result).toEqual({ handled: true, reason: 'top_up_pending' });
    expect(db.for).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledTimes(1);
    const updatePayload = db.set.mock.calls[0]?.[0];
    expect(updatePayload).toEqual({ updatedAt: expect.any(Date) });
    expect(updatePayload).not.toHaveProperty('arcopayOrderId');
  });

  it('returns cached paymentUrl without refreshing', async () => {
    db.limit.mockResolvedValueOnce([topUpRow()]);

    const result = await service.getTopUpPaymentUrl(topUpId, userId);

    expect(paymentProvider.getPaymentUrl).not.toHaveBeenCalled();
    expect(result.paymentUrl).toBe('https://qr.nspk.ru/top-up');
    expect(result.topUp.paymentUrl).toBe('https://qr.nspk.ru/top-up');
  });

  it('cancels a pending owned top-up', async () => {
    db.for.mockResolvedValueOnce([topUpRow({ status: 'pending' })]);
    db.returning.mockResolvedValueOnce([topUpRow({ status: 'cancelled' })]);

    const result = await service.cancelTopUp(topUpId, userId);

    expect(db.transaction).toHaveBeenCalled();
    expect(db.for).toHaveBeenCalledWith('update');
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'cancelled',
      }),
    );
    expect(result.topUp.status).toBe('cancelled');
  });

  it('does not cancel when locked top-up is no longer pending', async () => {
    db.for.mockResolvedValueOnce([topUpRow({ status: 'completed', paidAt })]);

    await expect(service.cancelTopUp(topUpId, userId)).rejects.toMatchObject({
      code: 'INVALID_TOP_UP_STATUS',
    });

    expect(db.transaction).toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });
});
