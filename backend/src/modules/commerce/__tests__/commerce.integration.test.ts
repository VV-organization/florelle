import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import type { Database } from '../../../shared/db/client';
import type { FxService } from '../../../shared/currency/fx.service';
import * as schema from '../../../shared/db/schema/index';
import { categories, products } from '../../../shared/db/schema/products';
import { listings } from '../../../shared/db/schema/listings';
import { sellers } from '../../../shared/db/schema/sellers';
import { users } from '../../../shared/db/schema/users';
import { orders, orderItems } from '../../../shared/db/schema/orders';
import { payments } from '../../../shared/db/schema/payments';
import { checkoutAttempts } from '../../../shared/db/schema/checkout';
import type { PaymentProvider, WebhookPayload } from '../../payments/payment-provider';
import { CommerceService } from '../commerce.service';
import { ScenarioCheckoutService } from '../scenario-checkout.service';
import { CommerceWebhookService } from '../commerce-webhook.service';
import type { CheckoutInput } from '../pricing';

// Opt in against a migrated local DB with the imported delivery settings.
// Every commercial row is owned by this suite; imported inventory is never modified.
const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase('CommerceService with real PostgreSQL', () => {
  let client: ReturnType<typeof postgres>;
  let db: Database;
  let service: CommerceService;
  let fixture: { categoryId: string; sellerId: string; productId: string; listingId: string; userIds: string[] };
  let provider: ReturnType<typeof paymentDouble>;

  function paymentDouble() {
    return {
      createPayment: vi.fn(async () => { throw new Error('Combined creation must not be used'); }),
      createPaymentOrder: vi.fn(async () => ({ externalId: `test-provider-${randomUUID()}` })),
      getPaymentUrl: vi.fn(async ({ externalId }: { externalId: string }) => ({ paymentUrl: `https://payments.example.test/${externalId}` })),
      verifyWebhookSignature: vi.fn((raw: Buffer, signature: string) => signature === sign(raw)),
      parseWebhookPayload: vi.fn((body: unknown): WebhookPayload => body as WebhookPayload),
    } satisfies PaymentProvider;
  }

  const sign = (raw: Buffer) => createHmac('sha256', 'local-integration-test-signing-key').update(raw).digest('hex');
  async function callback(payload: WebhookPayload, signature?: string) {
    const raw = Buffer.from(JSON.stringify(payload));
    return new CommerceWebhookService(db, provider).handleCallback(raw, signature ?? sign(raw), payload);
  }
  async function paymentPayload(orderId: string): Promise<WebhookPayload> {
    const attempt = await attempts(orderId);
    return { externalId: attempt.externalId!, merchantOrderId: attempt.merchantOrderId, amountMinor: attempt.amountMinor, currency: attempt.currency, status: 'paid' };
  }

  const input = (segment: 'b2b' | 'b2c' = 'b2c'): CheckoutInput => ({
    segment,
    displayCurrency: 'RUB',
    shippingAddress: { address: 'Москва, Тестовая улица, 1', contactName: 'Получатель Тест', contactPhone: '+79991234567' },
    delivery: { countryCode: 'RU', cityValue: 'Moscow', mode: 0, date: '2099-01-01', window: '13:00–18:00' },
  });

  async function addUser(segment: 'b2b' | 'b2c' = 'b2c') {
    const id = randomUUID(); fixture.userIds.push(id);
    await db.insert(users).values({ id, email: `commerce-${id}@example.test`, passwordHash: 'unused-test-hash', name: 'Тест Полное Имя', companyName: segment === 'b2b' ? 'Тест компания' : null, customerType: segment === 'b2b' ? 'legal_entity' : 'individual', status: 'active' });
    return id;
  }
  async function fillCart(userId: string, quantity = 10, segment: 'b2b' | 'b2c' = 'b2c') {
    return service.legacy.addCartItem(userId, { listingId: fixture.listingId, quantity, segment });
  }
  async function stock() {
    const [row] = await db.select({ value: listings.availableStems }).from(listings).where(eq(listings.id, fixture.listingId));
    return row!.value;
  }
  async function attempts(orderId: string) {
    const [attempt] = await db.select().from(checkoutAttempts).where(eq(checkoutAttempts.orderId, orderId));
    return attempt!;
  }

  beforeAll(() => {
    client = postgres(databaseUrl!, { max: 8, connect_timeout: 5 });
    db = drizzle(client, { schema });
  });
  afterAll(async () => { await client?.end(); });
  beforeEach(async () => {
    fixture = { categoryId: randomUUID(), sellerId: randomUUID(), productId: randomUUID(), listingId: randomUUID(), userIds: [] };
    provider = paymentDouble();
    const fx = { markup: 2.5, getRate: async (currency: string) => ({ USD: 1, RUB: 100, KZT: 500, TRY: 50 })[currency] } as FxService;
    service = new CommerceService(db, fx, provider, { commissionPercent: 12, cartTtlHours: 24, callbackUrl: 'https://shop.example.test/webhook', successUrl: 'https://shop.example.test/order/{orderId}', failUrl: 'https://shop.example.test/order/{orderId}' });
    await db.insert(categories).values({ id: fixture.categoryId, slug: `test-${fixture.categoryId}`, name: { en: 'Test category', ru: 'Тест категория' } });
    await db.insert(sellers).values({ id: fixture.sellerId, slug: `test-${fixture.sellerId}`, name: { en: 'Test seller', ru: 'Тест продавец' }, country: 'RU' });
    await db.insert(products).values({ id: fixture.productId, categoryId: fixture.categoryId, slug: `test-${fixture.productId}`, name: { en: 'Test rose', ru: 'Тест роза' }, species: 'rose', color: 'white', imageUrl: '/media/test-only.webp' });
    await db.insert(listings).values({ id: fixture.listingId, productId: fixture.productId, sellerId: fixture.sellerId, sellerPriceUsd: '9.99', amsPriceUsd: '8.88', wholesalePrice: '265.85', retailPrice: '411.33', referencePrice: '111.23', priceCurrency: 'RUB', boxQuantity: 10, availableStems: 100, deliveryDate: '2099-01-01' });
  });
  afterEach(async () => {
    if (!fixture) return;
    await db.transaction(async (tx) => {
      if (fixture.userIds.length) {
        const ownedOrders = await tx.select({ id: orders.id }).from(orders).where(inArray(orders.buyerId, fixture.userIds));
        if (ownedOrders.length) {
          const ids = ownedOrders.map((row) => row.id);
          await tx.delete(checkoutAttempts).where(inArray(checkoutAttempts.orderId, ids));
          await tx.delete(payments).where(inArray(payments.orderId, ids));
          await tx.delete(orderItems).where(inArray(orderItems.orderId, ids));
          await tx.delete(orders).where(inArray(orders.id, ids));
        }
        await tx.delete(users).where(inArray(users.id, fixture.userIds));
      }
      await tx.delete(listings).where(eq(listings.id, fixture.listingId));
      await tx.delete(products).where(eq(products.id, fixture.productId));
      await tx.delete(categories).where(eq(categories.id, fixture.categoryId));
      await tx.delete(sellers).where(eq(sellers.id, fixture.sellerId));
    });
  });

  it('preserves exact native RUB prices and B2C stock units through cart, quote and persisted order', async () => {
    const userId = await addUser(); await fillCart(userId);
    const cart = await service.getCart(userId);
    expect(cart.items[0]!.listing).toMatchObject({ sellerPrice: '411.33', amsPrice: '111.23', availableStock: 100, unit: 'stem' });
    expect(cart).toMatchObject({ subtotal: '4113.30', commission: '493.60', total: '4606.90' });
    const quote = await service.quote(userId, input());
    expect(quote).toMatchObject({ subtotal: '4113.30', commission: '493.60', shipping: '350.00', total: '4956.90', minimumMissing: '0.00', estimatedStems: 10, paymentAmountMinor: 495690 });
    const result = await service.createOrder(userId, input(), randomUUID());
    expect(result.order).toMatchObject({ total: '4956.90', totalUsd: '49.57', delivery: input().delivery });
    expect(await stock()).toBe(90);
    expect((await attempts(result.order.id)).amountMinor).toBe(495690);
    expect(provider.createPaymentOrder).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 495690 }));
  });

  it('uses boxes for B2B prices, reserves stems and applies persisted delivery tariffs', async () => {
    const userId = await addUser('b2b'); await fillCart(userId, 2, 'b2b');
    const cart = await service.getCart(userId);
    expect(cart.items[0]!.listing).toMatchObject({ sellerPrice: '265.85', availableStock: 10, unit: 'box' });
    expect(cart.items[0]!.lineTotal).toBe('5317.00');
    const quote = await service.quote(userId, input('b2b'));
    expect(quote).toMatchObject({ subtotal: '5317.00', commission: '638.04', shipping: '900.00', total: '6855.04', estimatedStems: 20, estimatedWeightKg: 2 });
    await service.createOrder(userId, input('b2b'), randomUUID());
    expect(await stock()).toBe(80);
  });

  it.each([
    { segment: 'b2c' as const, quantity: 6, missing: '235.86', total: '3114.14', minimum: '3 000' },
    { segment: 'b2b' as const, quantity: 1, missing: '2022.48', total: '3877.52', minimum: '5 000' },
  ])('rejects $segment below its minimum without reserving stock', async ({ segment, quantity, missing, total, minimum }) => {
    const userId = await addUser(segment); await fillCart(userId, quantity, segment);
    const quote = await service.quote(userId, input(segment));
    expect(quote).toMatchObject({ minimumMissing: missing, total });
    await expect(service.createOrder(userId, input(segment), randomUUID())).rejects.toMatchObject({ code: 'MINIMUM_ORDER', message: `Минимальная сумма заказа — ${minimum} ₽` });
    expect(await stock()).toBe(100); expect(provider.createPaymentOrder).not.toHaveBeenCalled();
    expect(await db.select().from(orders).where(eq(orders.buyerId, userId))).toEqual([]);
    expect((await service.getCart(userId)).items).toHaveLength(1);
  });

  it('replays the same key using one durable order and provider creation, including concurrent requests', async () => {
    const userId = await addUser(); await fillCart(userId); const key = randomUUID();
    const results = await Promise.all([service.createOrder(userId, input(), key), service.createOrder(userId, input(), key)]);
    expect(results[0]!.order.id).toBe(results[1]!.order.id);
    const replay = await service.createOrder(userId, input(), key);
    expect(replay.order.id).toBe(results[0]!.order.id);
    expect(provider.createPaymentOrder).toHaveBeenCalledTimes(1);
    expect(await stock()).toBe(90);
    expect(await db.select().from(orders).where(eq(orders.buyerId, userId))).toHaveLength(1);
  });

  it('rejects reuse of an idempotency key for a changed request', async () => {
    const userId = await addUser(); await fillCart(userId); const key = randomUUID();
    await service.createOrder(userId, input(), key);
    await expect(service.createOrder(userId, { ...input(), notes: 'Changed request' }, key)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(provider.createPaymentOrder).toHaveBeenCalledTimes(1); expect(await stock()).toBe(90);
  });

  it('serializes competing buyers for the last inventory and never oversells', async () => {
    await db.update(listings).set({ availableStems: 10 }).where(eq(listings.id, fixture.listingId));
    const first = await addUser(); const second = await addUser();
    await fillCart(first); await fillCart(second);
    const results = await Promise.allSettled([service.createOrder(first, input(), randomUUID()), service.createOrder(second, input(), randomUUID())]);
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((row) => row.status === 'rejected');
    expect(failure).toMatchObject({ status: 'rejected', reason: { code: 'INSUFFICIENT_STEMS' } });
    expect(await stock()).toBe(0); expect(provider.createPaymentOrder).toHaveBeenCalledTimes(1);
  });

  it('retries QRC retrieval using persisted external identity without creating payment twice', async () => {
    const userId = await addUser(); await fillCart(userId); const key = randomUUID();
    provider.getPaymentUrl.mockRejectedValueOnce(new Error('QRC temporarily unavailable'));
    const first = await service.createOrder(userId, input(), key);
    expect(first.paymentUrl).toBeUndefined();
    const durable = await attempts(first.order.id);
    expect(durable).toMatchObject({ state: 'created_external', paymentUrl: null }); expect(durable.externalId).toBeTruthy();
    const retry = await service.createOrder(userId, input(), key);
    expect(retry.paymentUrl).toContain(durable.externalId!);
    expect(provider.createPaymentOrder).toHaveBeenCalledTimes(1); expect(provider.getPaymentUrl).toHaveBeenCalledTimes(2);
    expect(await stock()).toBe(90);
  });

  it('preserves held stock and enters review on ambiguous provider creation timeout without retrying create', async () => {
    const userId = await addUser(); await fillCart(userId); const key = randomUUID();
    provider.createPaymentOrder.mockRejectedValueOnce(Object.assign(new Error('Provider request timed out'), { code: 'ETIMEDOUT' }));
    const first = await service.createOrder(userId, input(), key);
    expect(first).toMatchObject({ paymentStatus: 'review', order: { status: 'pending' } });
    expect(await attempts(first.order.id)).toMatchObject({ state: 'review', externalId: null });
    const retry = await service.createOrder(userId, input(), key);
    expect(retry).toMatchObject({ paymentStatus: 'review', order: { id: first.order.id } });
    expect(provider.createPaymentOrder).toHaveBeenCalledTimes(1); expect(provider.getPaymentUrl).not.toHaveBeenCalled(); expect(await stock()).toBe(90);
  });

  it('keeps immutable names, prices, delivery and totals after catalog changes', async () => {
    const userId = await addUser(); await fillCart(userId);
    const placed = await service.createOrder(userId, input(), randomUUID());
    await db.update(listings).set({ retailPrice: '9999.99', wholesalePrice: '5555.55' }).where(eq(listings.id, fixture.listingId));
    await db.update(products).set({ name: { ru: 'Изменённая роза', en: 'Changed rose' }, imageUrl: '/media/changed.webp' }).where(eq(products.id, fixture.productId));
    const persisted = await service.getOrder(userId, placed.order.id);
    expect(persisted.items).toEqual(placed.order.items);
    expect(persisted.items[0]).toMatchObject({ name: 'Тест роза', image: '/media/test-only.webp', price: '411.33', lineTotal: '4113.30' });
    expect(persisted).toMatchObject({ total: '4956.90', delivery: input().delivery });
  });
  it('rejects invalid signatures, amounts, currencies and identities without settling or releasing stock', async () => {
    const userId = await addUser(); await fillCart(userId);
    const placed = await service.createOrder(userId, input(), randomUUID());
    const payload = await paymentPayload(placed.order.id);
    expect(await callback(payload, 'invalid-signature')).toMatchObject({ handled: false, reason: 'invalid_signature' });
    for (const patch of [{ amountMinor: payload.amountMinor! + 1 }, { currency: 'USD' }]) {
      expect(await callback({ ...payload, ...patch })).toMatchObject({ handled: false, reason: 'payment_amount_mismatch' });
    }
    expect(await callback({ ...payload, merchantOrderId: 'wrong-order' })).toMatchObject({ handled: false, reason: 'merchant_order_mismatch' });
    expect(await callback({ ...payload, externalId: 'unknown-payment' })).toMatchObject({ handled: false, reason: 'payment_not_found' });
    expect(await service.getOrder(userId, placed.order.id)).toMatchObject({ status: 'pending' });
    expect(await attempts(placed.order.id)).toMatchObject({ state: 'ready' });
    expect(await stock()).toBe(90);
  });

  it('settles a matching callback once and never restores inventory after a later conflicting failure', async () => {
    const userId = await addUser(); await fillCart(userId);
    const placed = await service.createOrder(userId, input(), randomUUID());
    const payload = await paymentPayload(placed.order.id);
    expect(await callback(payload)).toMatchObject({ handled: true });
    expect(await callback(payload)).toMatchObject({ handled: true, reason: 'already_processed' });
    expect(await callback({ ...payload, status: 'failed' })).toMatchObject({ handled: true, reason: 'already_processed' });
    expect(await attempts(placed.order.id)).toMatchObject({ state: 'paid' });
    expect(await service.getOrder(userId, placed.order.id)).toMatchObject({ status: 'paid', paymentStatus: 'paid', paymentUrl: null });
    const [payment] = await db.select().from(payments).where(eq(payments.orderId, placed.order.id));
    expect(payment!.status).toBe('completed'); expect(await stock()).toBe(90);
  });

  it('releases held stems only once after a matching failed callback', async () => {
    const userId = await addUser(); await fillCart(userId);
    const placed = await service.createOrder(userId, input(), randomUUID());
    const payload = { ...await paymentPayload(placed.order.id), status: 'failed' as const };
    expect(await callback(payload)).toMatchObject({ handled: true });
    expect(await callback(payload)).toMatchObject({ handled: true, reason: 'already_processed' });
    expect(await attempts(placed.order.id)).toMatchObject({ state: 'failed' });
    expect(await service.getOrder(userId, placed.order.id)).toMatchObject({ status: 'cancelled', paymentStatus: 'failed', paymentUrl: null });
    expect(await stock()).toBe(100);
  });

  it('repairs attempt state when settlement committed before the attempt projection and callback is replayed', async () => {
    const userId = await addUser(); await fillCart(userId);
    const placed = await service.createOrder(userId, input(), randomUUID());
    const payload = await paymentPayload(placed.order.id);
    expect(await callback(payload)).toMatchObject({ handled: true });
    // Simulate a crash after the existing payment transaction committed.
    await db.update(checkoutAttempts).set({ state: 'ready' }).where(eq(checkoutAttempts.orderId, placed.order.id));
    expect(await callback(payload)).toMatchObject({ handled: true, reason: 'already_processed' });
    expect(await attempts(placed.order.id)).toMatchObject({ state: 'paid' });
    expect(await stock()).toBe(90);
  });

  it('recovers a durable created attempt after a crash before provider I/O exactly once across competing workers', async () => {
    // Recovery intentionally scans the DB: refuse to touch an unrelated pending attempt.
    const unrelated = await db.select().from(checkoutAttempts).where(inArray(checkoutAttempts.state, ['created', 'creating', 'created_external']));
    expect(unrelated, 'Recovery integration test requires no unrelated recoverable attempts').toEqual([]);
    const userId = await addUser(); await fillCart(userId);
    const stopped = vi.spyOn(service, 'advancePayment').mockResolvedValueOnce(undefined);
    const placed = await service.createOrder(userId, input(), randomUUID());
    stopped.mockRestore();
    expect(await attempts(placed.order.id)).toMatchObject({ state: 'created', externalId: null });
    expect(provider.createPaymentOrder).not.toHaveBeenCalled();
    await Promise.all([service.recoverPaymentLinks(), service.recoverPaymentLinks()]);
    await service.recoverPaymentLinks();
    expect(await attempts(placed.order.id)).toMatchObject({ state: 'ready' });
    expect(provider.createPaymentOrder).toHaveBeenCalledTimes(1);
    expect(await stock()).toBe(90);
  });

  it('keeps a synthetic reservation pending, blocks a different run and cleans up only after verified failure', async () => {
    const userId = await addUser(); await fillCart(userId);
    const adapter = new ScenarioCheckoutService(db, service), runId = randomUUID();
    const placed = await adapter.createSyntheticCheckoutPaymentReached({ userId, scenarioRunId: runId, request: input() });
    expect(placed.paymentUrl).toBeTruthy(); expect(adapter.supportsAuthoritativeCancellation).toBe(false);
    expect(await service.getOrder(userId, placed.order.id)).toMatchObject({ synthetic: true, scenarioRunId: runId });
    await expect(adapter.cancelSyntheticCheckoutPaymentReached({ orderId: placed.order.id, scenarioRunId: runId })).rejects.toMatchObject({ code: 'SYNTHETIC_PAYMENT_UNRESOLVED' });
    await expect(adapter.createSyntheticCheckoutPaymentReached({ userId, scenarioRunId: randomUUID(), request: input() })).rejects.toMatchObject({ code: 'SYNTHETIC_PREVIOUS_ATTEMPT_UNRESOLVED' });
    expect(await stock()).toBe(90); expect(provider.createPaymentOrder).toHaveBeenCalledTimes(1);
    const payload = { ...await paymentPayload(placed.order.id), status: 'failed' as const };
    expect(await callback(payload)).toMatchObject({ handled: true });
    await adapter.cancelSyntheticCheckoutPaymentReached({ orderId: placed.order.id, scenarioRunId: runId });
    await adapter.cancelSyntheticCheckoutPaymentReached({ orderId: placed.order.id, scenarioRunId: runId });
    expect(await stock()).toBe(100);
  });

  it('resumes only the matching synthetic run using the saved provider identity', async () => {
    const userId = await addUser(); await fillCart(userId);
    const adapter = new ScenarioCheckoutService(db, service), runId = randomUUID();
    provider.getPaymentUrl.mockRejectedValueOnce(new Error('Temporary QRC failure'));
    const placed = await adapter.createSyntheticCheckoutPaymentReached({ userId, scenarioRunId: runId, request: input() });
    expect(placed.paymentUrl).toBeUndefined();
    await expect(adapter.resumeSyntheticCheckoutPaymentReached({ orderId: placed.order.id, scenarioRunId: randomUUID() })).rejects.toMatchObject({ code: 'SYNTHETIC_ORDER_NOT_FOUND' });
    const resumed = await adapter.resumeSyntheticCheckoutPaymentReached({ orderId: placed.order.id, scenarioRunId: runId });
    expect(resumed.paymentUrl).toBeTruthy(); expect(provider.createPaymentOrder).toHaveBeenCalledTimes(1);
    expect(await stock()).toBe(90);
  });

  it.each(['paid', 'failed'] as const)('recovers a lost create response from concurrent signed %s callbacks without recreating the provider payment', async (status) => {
    const userId = await addUser(); await fillCart(userId); const key = randomUUID();
    provider.createPaymentOrder.mockRejectedValueOnce(Object.assign(new Error('Create response lost after provider accepted the request'), { code: 'ETIMEDOUT' }));
    const placed = await service.createOrder(userId, input(), key);
    const before = await attempts(placed.order.id);
    expect(before).toMatchObject({ state: 'review', externalId: null });
    expect(await db.select().from(payments).where(eq(payments.orderId, placed.order.id))).toEqual([]);
    const payload: WebhookPayload = { merchantOrderId: before.merchantOrderId, externalId: `recovered-provider-${randomUUID()}`, amountMinor: before.amountMinor, currency: 'RUB', status };
    const callbacks = await Promise.all([callback(payload), callback(payload)]);
    expect(callbacks).toEqual(expect.arrayContaining([expect.objectContaining({ handled: true })]));
    expect(callbacks.every((result) => result.handled)).toBe(true);
    const paymentRows = await db.select().from(payments).where(eq(payments.orderId, placed.order.id));
    expect(paymentRows).toHaveLength(1);
    expect(paymentRows[0]).toMatchObject({ externalId: payload.externalId, status: status === 'paid' ? 'completed' : 'failed' });
    expect(await attempts(placed.order.id)).toMatchObject({ externalId: payload.externalId, state: status });
    expect(await service.getOrder(userId, placed.order.id)).toMatchObject({ status: status === 'paid' ? 'paid' : 'cancelled', paymentStatus: status });
    expect(await stock()).toBe(status === 'paid' ? 90 : 100);
    const replay = await service.createOrder(userId, input(), key);
    expect(replay.order.id).toBe(placed.order.id);
    expect(provider.createPaymentOrder).toHaveBeenCalledTimes(1);
    expect(provider.getPaymentUrl).not.toHaveBeenCalled();
  });

  it('never binds an unknown provider identity to a review attempt on an invalid signature, merchant, amount or currency', async () => {
    const userId = await addUser(); await fillCart(userId); const key = randomUUID();
    provider.createPaymentOrder.mockRejectedValueOnce(Object.assign(new Error('Create response timeout'), { code: 'ETIMEDOUT' }));
    const placed = await service.createOrder(userId, input(), key);
    const before = await attempts(placed.order.id);
    const payload: WebhookPayload = { merchantOrderId: before.merchantOrderId, externalId: `untrusted-provider-${randomUUID()}`, amountMinor: before.amountMinor, currency: 'RUB', status: 'paid' };
    expect(await callback(payload, 'invalid-signature')).toMatchObject({ handled: false, reason: 'invalid_signature' });
    for (const patch of [{ merchantOrderId: `unknown-merchant-${randomUUID()}` }, { amountMinor: before.amountMinor + 1 }, { currency: 'USD' }]) {
      expect(await callback({ ...payload, ...patch })).toMatchObject({ handled: false });
      expect(await attempts(placed.order.id)).toMatchObject({ state: 'review', externalId: null });
      expect(await db.select().from(payments).where(eq(payments.orderId, placed.order.id))).toEqual([]);
    }
    expect(await service.getOrder(userId, placed.order.id)).toMatchObject({ status: 'pending', paymentStatus: 'review' });
    expect(await stock()).toBe(90);
    await service.createOrder(userId, input(), key);
    expect(provider.createPaymentOrder).toHaveBeenCalledTimes(1);
  });

  it.each(['success','timeout'] as const)('preserves callback settlement when an in-flight create later returns %s',async outcome=>{
    const userId=await addUser();await fillCart(userId);
    provider.createPaymentOrder.mockImplementationOnce(async params=>{
      const settled=await callback({merchantOrderId:params.merchantOrderId,externalId:'inflight-'+randomUUID(),amountMinor:params.amountMinor,currency:'RUB',status:'paid'});
      expect(settled.handled).toBe(true);
      const [intent]=await db.select().from(checkoutAttempts).where(eq(checkoutAttempts.merchantOrderId,params.merchantOrderId));
      if(outcome==='timeout')throw new Error('Response lost after callback');
      return {externalId:intent!.externalId!};
    });
    const placed=await service.createOrder(userId,input(),randomUUID());
    expect(placed.order.status).toBe('paid');expect((await attempts(placed.order.id)).state).toBe('paid');
    expect(provider.createPaymentOrder).toHaveBeenCalledTimes(1);expect(provider.getPaymentUrl).not.toHaveBeenCalled();
  });

});
