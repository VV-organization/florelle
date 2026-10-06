import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../shared/db/client';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { PaymentIntegrationOutbox } from '../payments.service';
import type { PaymentProvider, WebhookPayload } from '../payment-provider';
import { WebhookService } from '../payments.service';

function createQueryMock() {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    for: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  };
}

function createDbMock() {
  const tx = createQueryMock();
  const dbQueries = createQueryMock();
  const db = {
    ...dbQueries,
    transaction: vi.fn().mockImplementation(
      async (callback: (transaction: unknown) => Promise<unknown>) =>
        callback(tx),
    ),
  };
  return {
    db: db as unknown as Database & typeof db,
    tx,
  };
}

function createPaymentProviderMock(payload: WebhookPayload) {
  return {
    createPayment: vi.fn(),
    getPaymentUrl: vi.fn(),
    verifyWebhookSignature: vi.fn().mockReturnValue(true),
    parseWebhookPayload: vi.fn().mockReturnValue(payload),
  } as unknown as PaymentProvider & {
    verifyWebhookSignature: ReturnType<typeof vi.fn>;
    parseWebhookPayload: ReturnType<typeof vi.fn>;
  };
}

function createIntegrationOutboxMock() {
  return {
    enqueueOrderEvent: vi.fn().mockResolvedValue(undefined),
  } as unknown as PaymentIntegrationOutbox & {
    enqueueOrderEvent: ReturnType<typeof vi.fn>;
  };
}

function createNotificationsMock() {
  return {
    sendOrderPaid: vi.fn().mockResolvedValue(undefined),
  } as unknown as Pick<NotificationsService, 'sendOrderPaid'> & {
    sendOrderPaid: ReturnType<typeof vi.fn>;
  };
}

const paidPayload: WebhookPayload = {
  merchantOrderId: 'FL-20260713-TEST01',
  externalId: 'arcopay-order-id',
  status: 'paid',
};

const failedPayload: WebhookPayload = {
  ...paidPayload,
  status: 'failed',
};

describe('WebhookService', () => {
  let db: ReturnType<typeof createDbMock>['db'];
  let tx: ReturnType<typeof createDbMock>['tx'];

  beforeEach(() => {
    vi.clearAllMocks();
    ({ db, tx } = createDbMock());
  });

  it('rejects an invalid signature without parsing or starting a transaction', async () => {
    const paymentProvider = createPaymentProviderMock(paidPayload);
    paymentProvider.verifyWebhookSignature.mockReturnValue(false);
    const service = new WebhookService(db, paymentProvider);

    await expect(
      service.handleCallback(Buffer.from('{}'), 'invalid-signature', {}),
    ).resolves.toEqual({ handled: false, reason: 'invalid_signature' });

    expect(paymentProvider.parseWebhookPayload).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('returns a parse failure without starting a transaction', async () => {
    const paymentProvider = createPaymentProviderMock(paidPayload);
    paymentProvider.parseWebhookPayload.mockImplementation(() => {
      throw new Error('invalid callback body');
    });
    const service = new WebhookService(db, paymentProvider);

    await expect(
      service.handleCallback(Buffer.from('{}'), 'signature', {}),
    ).resolves.toEqual({ handled: false, reason: 'parse_failed' });

    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('does not transition an order for an intermediate provider status', async () => {
    const paymentProvider = createPaymentProviderMock({
      ...paidPayload,
      status: 'pending',
    });
    const service = new WebhookService(db, paymentProvider);

    await expect(
      service.handleCallback(Buffer.from('{}'), 'signature', {}),
    ).resolves.toEqual({ handled: true, reason: 'payment_pending' });

    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('marks a pending direct order paid exactly once', async () => {
    const paymentProvider = createPaymentProviderMock(paidPayload);
    const service = new WebhookService(db, paymentProvider);
    tx.for
      .mockResolvedValueOnce([
        { id: 'payment-1', orderId: 'order-1', status: 'pending' },
      ])
      .mockResolvedValueOnce([{
        id: 'order-1', status: 'pending', merchantOrderId: paidPayload.merchantOrderId,
      }]);

    await expect(
      service.handleCallback(Buffer.from('{}'), 'signature', {}),
    ).resolves.toEqual({ handled: true });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(tx.for).toHaveBeenNthCalledWith(1, 'update');
    expect(tx.for).toHaveBeenNthCalledWith(2, 'update');
    expect(tx.set).toHaveBeenCalledWith({
      status: 'paid',
      updatedAt: expect.any(Date),
    });
    expect(tx.set).toHaveBeenCalledWith({
      status: 'completed',
      updatedAt: expect.any(Date),
    });
    expect(
      tx.set.mock.calls.filter(([value]) =>
        ['paid', 'completed'].includes(
          (value as { status?: string }).status ?? '',
        ),
      ),
    ).toHaveLength(2);
    expect(db.select).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('enqueues an order.paid event after a paid callback transition', async () => {
    const paymentProvider = createPaymentProviderMock(paidPayload);
    const outbox = createIntegrationOutboxMock();
    const service = new WebhookService(db, paymentProvider, outbox);
    tx.for
      .mockResolvedValueOnce([
        { id: 'payment-1', orderId: 'order-1', status: 'pending', provider: 'arcopay' },
      ])
      .mockResolvedValueOnce([{
        id: 'order-1',
        status: 'pending',
        merchantOrderId: paidPayload.merchantOrderId,
        totalUsd: '120.00',
        createdAt: new Date('2026-08-14T10:00:00.000Z'),
      }]);
    tx.where
      .mockReturnValueOnce(tx)
      .mockReturnValueOnce(tx)
      .mockResolvedValueOnce([{
        id: 'item-1',
        listingId: 'listing-1',
        quantity: 2,
        unitPriceUsd: '60.00',
        productName: 'Rose',
      }])
      .mockReturnValue(tx);

    await service.handleCallback(Buffer.from('{}'), 'signature', {});

    expect(outbox.enqueueOrderEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'order.paid',
        source: 'customer',
        payment: expect.objectContaining({ status: 'paid' }),
      }),
    );
  });

  it('sends a paid order email after a paid callback transition', async () => {
    const paymentProvider = createPaymentProviderMock(paidPayload);
    const notifications = createNotificationsMock();
    const service = new WebhookService(db, paymentProvider, undefined, notifications);
    tx.for
      .mockResolvedValueOnce([
        { id: 'payment-1', orderId: 'order-1', status: 'pending', provider: 'arcopay' },
      ])
      .mockResolvedValueOnce([{
        id: 'order-1',
        buyerId: 'user-1',
        status: 'pending',
        merchantOrderId: paidPayload.merchantOrderId,
        totalUsd: '120.00',
        createdAt: new Date('2026-08-14T10:00:00.000Z'),
      }]);
    tx.limit.mockResolvedValueOnce([{ email: 'buyer@example.com' }]);

    await expect(
      service.handleCallback(Buffer.from('{}'), 'signature', {}),
    ).resolves.toEqual({ handled: true });

    expect(notifications.sendOrderPaid).toHaveBeenCalledWith({
      to: 'buyer@example.com',
      orderId: 'order-1',
      totalUsd: '120.00',
      paidAt: expect.any(Date),
      idempotencyKey: 'order-paid/order-1',
    });
  });

  it('does not send a paid order email for an already processed callback', async () => {
    const paymentProvider = createPaymentProviderMock(paidPayload);
    const notifications = createNotificationsMock();
    const service = new WebhookService(db, paymentProvider, undefined, notifications);
    tx.for.mockResolvedValueOnce([
      { id: 'payment-1', orderId: 'order-1', status: 'completed' },
    ]);

    await expect(
      service.handleCallback(Buffer.from('{}'), 'signature', {}),
    ).resolves.toEqual({ handled: true, reason: 'already_processed' });

    expect(notifications.sendOrderPaid).not.toHaveBeenCalled();
  });

  it('labels a paid callback for a synthetic order as a scenario event', async () => {
    const paymentProvider = createPaymentProviderMock(paidPayload);
    const outbox = createIntegrationOutboxMock();
    const service = new WebhookService(db, paymentProvider, outbox);
    tx.for
      .mockResolvedValueOnce([
        { id: 'payment-1', orderId: 'order-1', status: 'pending', provider: 'arcopay' },
      ])
      .mockResolvedValueOnce([{
        id: 'order-1',
        status: 'pending',
        merchantOrderId: paidPayload.merchantOrderId,
        totalUsd: '120.00',
        createdAt: new Date('2026-08-14T10:00:00.000Z'),
        synthetic: true,
      }]);
    tx.where
      .mockReturnValueOnce(tx)
      .mockReturnValueOnce(tx)
      .mockResolvedValueOnce([{
        id: 'item-1',
        listingId: 'listing-1',
        quantity: 2,
        unitPriceUsd: '60.00',
        productName: 'Rose',
      }])
      .mockReturnValue(tx);

    await service.handleCallback(Buffer.from('{}'), 'signature', {});

    expect(outbox.enqueueOrderEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'order.paid', source: 'scenario' }),
    );
  });

  it('rejects a paid callback whose merchant order id does not match the locked order', async () => {
    const paymentProvider = createPaymentProviderMock(paidPayload);
    const service = new WebhookService(db, paymentProvider);
    tx.for
      .mockResolvedValueOnce([
        { id: 'payment-1', orderId: 'order-1', status: 'pending' },
      ])
      .mockResolvedValueOnce([{
        id: 'order-1',
        status: 'pending',
        merchantOrderId: 'FL-20260713-DIFFERENT',
      }]);

    await expect(
      service.handleCallback(Buffer.from('{}'), 'signature', {}),
    ).resolves.toEqual({ handled: false, reason: 'merchant_order_mismatch' });

    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.set).not.toHaveBeenCalled();
  });

  it('rejects when a transactional terminal write fails', async () => {
    const paymentProvider = createPaymentProviderMock(paidPayload);
    const service = new WebhookService(db, paymentProvider);
    tx.for
      .mockResolvedValueOnce([
        { id: 'payment-1', orderId: 'order-1', status: 'pending' },
      ])
      .mockResolvedValueOnce([{
        id: 'order-1', status: 'pending', merchantOrderId: paidPayload.merchantOrderId,
      }]);
    tx.set
      .mockReturnValueOnce(tx)
      .mockImplementationOnce(() => {
        throw new Error('payment update failed');
      });

    await expect(
      service.handleCallback(Buffer.from('{}'), 'signature', {}),
    ).rejects.toThrow('payment update failed');

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(tx.update).toHaveBeenCalledTimes(2);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('restores exact reserved stems when a direct payment fails', async () => {
    const paymentProvider = createPaymentProviderMock(failedPayload);
    const service = new WebhookService(db, paymentProvider);
    tx.for
      .mockResolvedValueOnce([
        { id: 'payment-1', orderId: 'order-1', status: 'pending' },
      ])
      .mockResolvedValueOnce([{
        id: 'order-1', status: 'pending', merchantOrderId: failedPayload.merchantOrderId,
      }])
      .mockResolvedValueOnce([
        { id: 'listing-1', availableStems: 100 },
      ]);
    tx.where
      .mockReturnValueOnce(tx)
      .mockReturnValueOnce(tx)
      .mockResolvedValueOnce([
        { listingId: 'listing-1', reservedStems: 75 },
      ])
      .mockReturnValue(tx);

    await expect(
      service.handleCallback(Buffer.from('{}'), 'signature', {}),
    ).resolves.toEqual({ handled: true });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(tx.set).toHaveBeenCalledWith({ availableStems: 175 });
    expect(tx.set).toHaveBeenCalledWith({
      status: 'cancelled',
      updatedAt: expect.any(Date),
    });
    expect(tx.set).toHaveBeenCalledWith({
      status: 'failed',
      updatedAt: expect.any(Date),
    });
  });

  it('enqueues an order.cancelled event after a failed callback transition', async () => {
    const paymentProvider = createPaymentProviderMock(failedPayload);
    const outbox = createIntegrationOutboxMock();
    const service = new WebhookService(db, paymentProvider, outbox);
    tx.for
      .mockResolvedValueOnce([
        { id: 'payment-1', orderId: 'order-1', status: 'pending', provider: 'arcopay' },
      ])
      .mockResolvedValueOnce([{
        id: 'order-1',
        status: 'pending',
        merchantOrderId: failedPayload.merchantOrderId,
        totalUsd: '120.00',
        createdAt: new Date('2026-08-14T10:00:00.000Z'),
      }])
      .mockResolvedValueOnce([
        { id: 'listing-1', availableStems: 100 },
      ]);
    tx.where
      .mockReturnValueOnce(tx)
      .mockReturnValueOnce(tx)
      .mockResolvedValueOnce([{
        id: 'item-1',
        listingId: 'listing-1',
        quantity: 2,
        reservedStems: 75,
        unitPriceUsd: '60.00',
        productName: 'Rose',
      }])
      .mockReturnValue(tx);

    await service.handleCallback(Buffer.from('{}'), 'signature', {});

    expect(outbox.enqueueOrderEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'order.cancelled',
        source: 'customer',
        payment: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });

  it('labels a failed callback for a synthetic order as a scenario event', async () => {
    const paymentProvider = createPaymentProviderMock(failedPayload);
    const outbox = createIntegrationOutboxMock();
    const service = new WebhookService(db, paymentProvider, outbox);
    tx.for
      .mockResolvedValueOnce([
        { id: 'payment-1', orderId: 'order-1', status: 'pending', provider: 'arcopay' },
      ])
      .mockResolvedValueOnce([{
        id: 'order-1',
        status: 'pending',
        merchantOrderId: failedPayload.merchantOrderId,
        totalUsd: '120.00',
        createdAt: new Date('2026-08-14T10:00:00.000Z'),
        synthetic: true,
      }])
      .mockResolvedValueOnce([{ id: 'listing-1', availableStems: 100 }]);
    tx.where
      .mockReturnValueOnce(tx)
      .mockReturnValueOnce(tx)
      .mockResolvedValueOnce([{
        id: 'item-1',
        listingId: 'listing-1',
        quantity: 2,
        reservedStems: 75,
        unitPriceUsd: '60.00',
        productName: 'Rose',
      }])
      .mockReturnValue(tx);

    await service.handleCallback(Buffer.from('{}'), 'signature', {});

    expect(outbox.enqueueOrderEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'order.cancelled', source: 'scenario' }),
    );
  });

  it('rejects a failed callback whose merchant order id does not match the locked order', async () => {
    const paymentProvider = createPaymentProviderMock(failedPayload);
    const service = new WebhookService(db, paymentProvider);
    tx.for
      .mockResolvedValueOnce([
        { id: 'payment-1', orderId: 'order-1', status: 'pending' },
      ])
      .mockResolvedValueOnce([{
        id: 'order-1',
        status: 'pending',
        merchantOrderId: 'FL-20260713-DIFFERENT',
      }]);

    await expect(
      service.handleCallback(Buffer.from('{}'), 'signature', {}),
    ).resolves.toEqual({ handled: false, reason: 'merchant_order_mismatch' });

    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.set).not.toHaveBeenCalled();
  });

  it('aggregates duplicate reservations and locks listings in sorted order', async () => {
    const paymentProvider = createPaymentProviderMock(failedPayload);
    const service = new WebhookService(db, paymentProvider);
    tx.for
      .mockResolvedValueOnce([
        { id: 'payment-1', orderId: 'order-1', status: 'pending' },
      ])
      .mockResolvedValueOnce([{
        id: 'order-1', status: 'pending', merchantOrderId: failedPayload.merchantOrderId,
      }])
      .mockResolvedValueOnce([
        { id: 'listing-a', availableStems: 100 },
      ])
      .mockResolvedValueOnce([
        { id: 'listing-z', availableStems: 200 },
      ]);
    tx.where
      .mockReturnValueOnce(tx)
      .mockReturnValueOnce(tx)
      .mockResolvedValueOnce([
        { listingId: 'listing-z', reservedStems: 50 },
        { listingId: 'listing-a', reservedStems: 10 },
        { listingId: 'listing-z', reservedStems: 25 },
      ])
      .mockReturnValue(tx);

    await service.handleCallback(Buffer.from('{}'), 'signature', {});

    expect(tx.set.mock.calls[0]).toEqual([{ availableStems: 110 }]);
    expect(tx.set.mock.calls[1]).toEqual([{ availableStems: 275 }]);
  });

  it('does not partially restore stock when a reserved listing is missing', async () => {
    const paymentProvider = createPaymentProviderMock(failedPayload);
    const service = new WebhookService(db, paymentProvider);
    tx.for
      .mockResolvedValueOnce([
        { id: 'payment-1', orderId: 'order-1', status: 'pending' },
      ])
      .mockResolvedValueOnce([{
        id: 'order-1', status: 'pending', merchantOrderId: failedPayload.merchantOrderId,
      }])
      .mockResolvedValueOnce([
        { id: 'listing-a', availableStems: 100 },
      ])
      .mockResolvedValueOnce([]);
    tx.where
      .mockReturnValueOnce(tx)
      .mockReturnValueOnce(tx)
      .mockResolvedValueOnce([
        { listingId: 'listing-a', reservedStems: 10 },
        { listingId: 'listing-z', reservedStems: 20 },
      ])
      .mockReturnValue(tx);

    await expect(
      service.handleCallback(Buffer.from('{}'), 'signature', {}),
    ).resolves.toEqual({ handled: false, reason: 'listing_not_found' });

    expect(tx.set).not.toHaveBeenCalled();
  });

  it.each(['completed', 'failed'] as const)(
    'treats an already-%s payment as already processed',
    async (status) => {
      const paymentProvider = createPaymentProviderMock(
        status === 'completed' ? paidPayload : failedPayload,
      );
      const service = new WebhookService(db, paymentProvider);
      tx.for.mockResolvedValueOnce([
        { id: 'payment-1', orderId: 'order-1', status },
      ]);

      await expect(
        service.handleCallback(Buffer.from('{}'), 'signature', {}),
      ).resolves.toEqual({ handled: true, reason: 'already_processed' });

      expect(tx.for).toHaveBeenCalledTimes(1);
      expect(tx.update).not.toHaveBeenCalled();
    },
  );

  it('returns payment_not_found when no direct payment matches', async () => {
    const paymentProvider = createPaymentProviderMock(paidPayload);
    const service = new WebhookService(db, paymentProvider);
    tx.for.mockResolvedValueOnce([]);

    await expect(
      service.handleCallback(Buffer.from('{}'), 'signature', {}),
    ).resolves.toEqual({ handled: false, reason: 'payment_not_found' });

    expect(tx.update).not.toHaveBeenCalled();
  });

  it('returns order_not_found when the direct payment has no order', async () => {
    const paymentProvider = createPaymentProviderMock(paidPayload);
    const service = new WebhookService(db, paymentProvider);
    tx.for
      .mockResolvedValueOnce([
        { id: 'payment-1', orderId: 'order-1', status: 'pending' },
      ])
      .mockResolvedValueOnce([]);

    await expect(
      service.handleCallback(Buffer.from('{}'), 'signature', {}),
    ).resolves.toEqual({ handled: false, reason: 'order_not_found' });

    expect(tx.update).not.toHaveBeenCalled();
  });

  it('rejects an invalid direct-order state transition', async () => {
    const paymentProvider = createPaymentProviderMock(paidPayload);
    const service = new WebhookService(db, paymentProvider);
    tx.for
      .mockResolvedValueOnce([
        { id: 'payment-1', orderId: 'order-1', status: 'pending' },
      ])
      .mockResolvedValueOnce([{
        id: 'order-1', status: 'delivered', merchantOrderId: paidPayload.merchantOrderId,
      }]);

    await expect(
      service.handleCallback(Buffer.from('{}'), 'signature', {}),
    ).resolves.toEqual({ handled: false, reason: 'invalid_transition' });

    expect(tx.update).not.toHaveBeenCalled();
  });
});
