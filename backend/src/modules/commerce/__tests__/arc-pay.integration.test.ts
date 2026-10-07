import { createHmac, randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray } from "drizzle-orm";
import type { Database } from "../../../shared/db/client";
import type { FxService } from "../../../shared/currency/fx.service";
import * as schema from "../../../shared/db/schema/index";
import { categories, products } from "../../../shared/db/schema/products";
import { listings } from "../../../shared/db/schema/listings";
import { sellers } from "../../../shared/db/schema/sellers";
import { users } from "../../../shared/db/schema/users";
import { orders, orderItems } from "../../../shared/db/schema/orders";
import { payments } from "../../../shared/db/schema/payments";
import { checkoutAttempts } from "../../../shared/db/schema/checkout";
import { ArcPayClient, type ArcPayment } from "../../payments/arc-pay-client";
import { ArcPayService } from "../../payments/arc-pay.service";
import { arcPayEvents, paymentEmails } from "../../../shared/db/schema/arc-pay";
import type {
  PaymentProvider,
  WebhookPayload,
} from "../../payments/payment-provider";
import { CommerceService } from "../commerce.service";
import { ScenarioCheckoutService } from "../scenario-checkout.service";
import { CommerceWebhookService } from "../commerce-webhook.service";
import type { CheckoutInput } from "../pricing";

// Opt in against a migrated local DB with the imported delivery settings.
// Every commercial row is owned by this suite; imported inventory is never modified.
const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Arc Pay durable checkout with PostgreSQL", () => {
  let client: ReturnType<typeof postgres>;
  let db: Database;
  let service: CommerceService;
  let arc: ArcPayService;
  let apiPayments: ArcPayment[];
  let creates: { key: string; body: any }[];
  let failCreate: boolean;
  let advertisedLimits: { min_amount?: number; max_amount?: number };
  let onCreate: (() => Promise<void>) | undefined;

  let fixture: {
    categoryId: string;
    sellerId: string;
    productId: string;
    listingId: string;
    userIds: string[];
  };
  let provider: ReturnType<typeof paymentDouble>;

  function paymentDouble() {
    return {
      createPayment: vi.fn(async () => {
        throw new Error("Combined creation must not be used");
      }),
      createPaymentOrder: vi.fn(async () => ({
        externalId: `test-provider-${randomUUID()}`,
      })),
      getPaymentUrl: vi.fn(async ({ externalId }: { externalId: string }) => ({
        paymentUrl: `https://payments.example.test/${externalId}`,
      })),
      verifyWebhookSignature: vi.fn(
        (raw: Buffer, signature: string) => signature === sign(raw),
      ),
      parseWebhookPayload: vi.fn(
        (body: unknown): WebhookPayload => body as WebhookPayload,
      ),
    } satisfies PaymentProvider;
  }

  const sign = (raw: Buffer) =>
    createHmac("sha256", "local-integration-test-signing-key")
      .update(raw)
      .digest("hex");
  async function callback(payload: WebhookPayload, signature?: string) {
    const raw = Buffer.from(JSON.stringify(payload));
    return new CommerceWebhookService(db, provider).handleCallback(
      raw,
      signature ?? sign(raw),
      payload,
    );
  }
  async function paymentPayload(orderId: string): Promise<WebhookPayload> {
    const attempt = await attempts(orderId);
    return {
      externalId: attempt.externalId!,
      merchantOrderId: attempt.merchantOrderId,
      amountMinor: attempt.amountMinor,
      currency: attempt.currency,
      status: "paid",
    };
  }

  const input = (segment: "b2b" | "b2c" = "b2c"): CheckoutInput => ({
    segment,
    displayCurrency: "RUB",
    shippingAddress: {
      address: "Москва, Тестовая улица, 1",
      contactName: "Получатель Тест",
      contactPhone: "+79991234567",
    },
    delivery: {
      countryCode: "RU",
      cityValue: "Moscow",
      mode: 0,
      date: "2099-01-01",
      window: "13:00–18:00",
    },
  });

  async function addUser(segment: "b2b" | "b2c" = "b2c") {
    const id = randomUUID();
    fixture.userIds.push(id);
    await db
      .insert(users)
      .values({
        id,
        email: `commerce-${id}@example.test`,
        passwordHash: "unused-test-hash",
        name: "Тест Полное Имя",
        companyName: segment === "b2b" ? "Тест компания" : null,
        customerType: segment === "b2b" ? "legal_entity" : "individual",
        status: "active",
      });
    return id;
  }
  async function fillCart(
    userId: string,
    quantity = 10,
    segment: "b2b" | "b2c" = "b2c",
  ) {
    return service.legacy.addCartItem(userId, {
      listingId: fixture.listingId,
      quantity,
      segment,
    });
  }
  async function stock() {
    const [row] = await db
      .select({ value: listings.availableStems })
      .from(listings)
      .where(eq(listings.id, fixture.listingId));
    return row!.value;
  }
  async function attempts(orderId: string) {
    const [attempt] = await db
      .select()
      .from(checkoutAttempts)
      .where(eq(checkoutAttempts.orderId, orderId));
    return attempt!;
  }

  beforeAll(() => {
    client = postgres(databaseUrl!, { max: 8, connect_timeout: 5 });
    db = drizzle(client, { schema });
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    fixture = {
      categoryId: randomUUID(),
      sellerId: randomUUID(),
      productId: randomUUID(),
      listingId: randomUUID(),
      userIds: [],
    };
    provider = paymentDouble();
    apiPayments = [];
    creates = [];
    failCreate = false;
    advertisedLimits = {};
    onCreate = undefined;
    const client = new ArcPayClient({
      secretKey: "sk_test_local",
      fetchFn: async (url, init) => {
        const path = new URL(String(url));
        if (path.pathname.endsWith("/payment-methods/available"))
          return Response.json([
            {
              method: "sbp",
              payment_mode: "h2h",
              is_active: true,
              ...advertisedLimits,
            },
          ]);
        if (path.pathname.endsWith("/checkout/sessions")) {
          creates.push({
            key: (init?.headers as Record<string, string>)["Idempotency-Key"]!,
            body: JSON.parse(String(init?.body)),
          });
          if (onCreate) await onCreate();
          if (failCreate) throw new Error("Network timeout");
          return Response.json({
            id: "session-" + creates.at(-1)!.key,
            url: "https://checkout.arcpay.space/" + creates.at(-1)!.key,
          });
        }
        if (path.pathname.endsWith("/payments"))
          return Response.json({ data: apiPayments, next_cursor: null });
        const payment = apiPayments.find(
          (p) => p.id === path.pathname.split("/").at(-1),
        );
        return payment
          ? Response.json(payment)
          : Response.json({}, { status: 404 });
      },
    });
    arc = new ArcPayService(db, client);
    const fx = {
      markup: 2.5,
      getRate: async (currency: string) =>
        ({ USD: 1, RUB: 100, KZT: 500, TRY: 50 })[currency],
    } as FxService;
    service = new CommerceService(
      db,
      fx,
      provider,
      {
        commissionPercent: 12,
        cartTtlHours: 24,
        callbackUrl: "https://shop.example.test/webhook",
        successUrl: "https://shop.example.test/order/{orderId}",
        failUrl: "https://shop.example.test/order/{orderId}",
      },
      undefined,
      arc,
    );
    await db
      .insert(categories)
      .values({
        id: fixture.categoryId,
        slug: `test-${fixture.categoryId}`,
        name: { en: "Test category", ru: "Тест категория" },
      });
    await db
      .insert(sellers)
      .values({
        id: fixture.sellerId,
        slug: `test-${fixture.sellerId}`,
        name: { en: "Test seller", ru: "Тест продавец" },
        country: "RU",
      });
    await db
      .insert(products)
      .values({
        id: fixture.productId,
        categoryId: fixture.categoryId,
        slug: `test-${fixture.productId}`,
        name: { en: "Test rose", ru: "Тест роза" },
        species: "rose",
        color: "white",
        imageUrl: "/media/test-only.webp",
      });
    await db
      .insert(listings)
      .values({
        id: fixture.listingId,
        productId: fixture.productId,
        sellerId: fixture.sellerId,
        sellerPriceUsd: "9.99",
        amsPriceUsd: "8.88",
        wholesalePrice: "53.17",
        retailPrice: "137.11",
        referencePrice: "111.23",
        priceCurrency: "RUB",
        boxQuantity: 10,
        availableStems: 100,
        deliveryDate: "2099-01-01",
      });
  });
  afterEach(async () => {
    if (!fixture) return;
    await db.delete(arcPayEvents);
    await db.transaction(async (tx) => {
      if (fixture.userIds.length) {
        const ownedOrders = await tx
          .select({ id: orders.id })
          .from(orders)
          .where(inArray(orders.buyerId, fixture.userIds));
        if (ownedOrders.length) {
          const ids = ownedOrders.map((row) => row.id);
          await tx
            .delete(paymentEmails)
            .where(inArray(paymentEmails.orderId, ids));
          await tx
            .delete(checkoutAttempts)
            .where(inArray(checkoutAttempts.orderId, ids));
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

  async function place() {
    const userId = await addUser();
    await fillCart(userId);
    const result = await service.createOrder(userId, input(), randomUUID());
    return { userId, ...result };
  }
  async function due(orderId: string) {
    await db
      .update(checkoutAttempts)
      .set({ nextAttemptAt: new Date(0), leaseUntil: null })
      .where(eq(checkoutAttempts.orderId, orderId));
  }
  async function remote(
    orderId: string,
    status = "captured",
    patch: Partial<ArcPayment> = {},
  ) {
    const a = await attempts(orderId);
    const p: ArcPayment = {
      id: "payment-" + a.id,
      external_id: a.id,
      status,
      amount: a.amountMinor,
      currency: "RUB",
      payment_method: "sbp",
      payment_mode: "h2h",
      metadata: { florelle_order_id: orderId },
      ...patch,
    };
    apiPayments = [p];
    return p;
  }
  it("stores hosted session separately from payment identity and immutable request", async () => {
    const p = await place(),
      a = await attempts(p.order.id);
    expect(a).toMatchObject({
      provider: "arc_pay",
      sessionId: "session-" + a.id,
      externalId: null,
      state: "ready",
      environment: "sandbox",
    });
    expect(p.paymentUrl).toBe("https://checkout.arcpay.space/" + a.id);
    expect(creates[0]).toMatchObject({
      key: a.id,
      body: {
        external_id: a.id,
        amount: 188563,
        currency: "RUB",
        customer_email: expect.any(String),
        payment_methods: [{ method: "sbp", payment_mode: "h2h" }],
      },
    });
    expect(await stock()).toBe(90);
    expect(
      await db.select().from(payments).where(eq(payments.orderId, p.order.id)),
    ).toHaveLength(0);
  });
  it("replays a lost response with exactly the same key and snapshot across concurrent workers", async () => {
    failCreate = true;
    const p = await place();
    expect(p.paymentStatus).toBe("pending");
    await db
      .update(users)
      .set({ email: "changed@example.test" })
      .where(eq(users.id, p.userId));
    failCreate = false;
    await due(p.order.id);
    await Promise.all([arc.advance(p.order.id), arc.advance(p.order.id)]);
    expect(creates).toHaveLength(2);
    expect(creates[0]).toEqual(creates[1]);
    expect(await stock()).toBe(90);
  });
  it("does not retry create after the idempotency window", async () => {
    failCreate = true;
    const p = await place();
    await db
      .update(checkoutAttempts)
      .set({
        firstRequestAt: new Date(Date.now() - 73 * 3600000),
        nextAttemptAt: new Date(0),
      })
      .where(eq(checkoutAttempts.orderId, p.order.id));
    await arc.advance(p.order.id);
    expect(creates).toHaveLength(1);
    expect(await attempts(p.order.id)).toMatchObject({ state: "review" });
    expect(await stock()).toBe(90);
  });
  it("settles once through reconciliation without a webhook and enqueues a single email", async () => {
    const p = await place();
    await remote(p.order.id);
    await due(p.order.id);
    await arc.tick();
    expect(await service.getOrder(p.userId, p.order.id)).toMatchObject({
      status: "paid",
      paymentUrl: null,
      paymentStatus: "paid",
    });
    expect(await attempts(p.order.id)).toMatchObject({
      state: "paid",
      externalId: apiPayments[0]!.id,
    });
    await arc.reconcile(p.order.id);
    await arc.reconcile(p.order.id);
    expect(
      await db
        .select()
        .from(paymentEmails)
        .where(eq(paymentEmails.orderId, p.order.id)),
    ).toHaveLength(1);
    expect(await stock()).toBe(90);
  });
  it("keeps timeout pending, then accepts capture", async () => {
    const p = await place();
    await remote(p.order.id, "timeout");
    await arc.reconcile(p.order.id);
    expect(await service.getOrder(p.userId, p.order.id)).toMatchObject({
      status: "pending",
    });
    expect(await stock()).toBe(90);
    await remote(p.order.id);
    await arc.reconcile(p.order.id);
    expect((await service.getOrder(p.userId, p.order.id)).status).toBe("paid");
  });
  it("restores inventory once on a confirmed failure but never on a late failure after payment", async () => {
    const p = await place();
    await remote(p.order.id, "failed");
    await arc.reconcile(p.order.id);
    await arc.reconcile(p.order.id);
    expect(await stock()).toBe(100);
    expect((await service.getOrder(p.userId, p.order.id)).status).toBe(
      "cancelled",
    );
    const q = await place();
    await remote(q.order.id);
    await arc.reconcile(q.order.id);
    await remote(q.order.id, "failed");
    await arc.reconcile(q.order.id);
    expect(await stock()).toBe(90);
    expect((await service.getOrder(q.userId, q.order.id)).status).toBe("paid");
  });
  it.each([
    { amount: 1 },
    { currency: "USD" },
    { payment_method: "bank_card" },
    { metadata: { florelle_order_id: "wrong" } },
  ])(
    "quarantines mismatched provider data %j without releasing stock",
    async (patch) => {
      const p = await place();
      await remote(p.order.id, "captured", patch);
      await arc.reconcile(p.order.id);
      expect(await attempts(p.order.id)).toMatchObject({ state: "review" });
      expect(await stock()).toBe(90);
      expect((await service.getOrder(p.userId, p.order.id)).status).toBe(
        "pending",
      );
    },
  );
  it("does not bind an unrelated provider external id", async () => {
    const p = await place();
    const payment = await remote(p.order.id, "captured", {
      external_id: "unrelated",
    });
    await arc.receive("unrelated-event", {
      event_type: "payment.captured",
      data: { payment_id: payment.id },
    });
    await arc.tick();
    expect((await attempts(p.order.id)).externalId).toBeNull();
    expect((await service.getOrder(p.userId, p.order.id)).status).toBe(
      "pending",
    );
  });
  it("detects multiple exact payments instead of picking one", async () => {
    const p = await place();
    const first = await remote(p.order.id);
    apiPayments.push({ ...first, id: "another-payment" });
    await arc.reconcile(p.order.id);
    expect(await attempts(p.order.id)).toMatchObject({
      state: "review",
      reviewReason: "multiple_payments",
    });
    expect(await stock()).toBe(90);
  });
  it("processes a durable duplicate event only once and handles data.payment_id", async () => {
    const p = await place();
    const payment = await remote(p.order.id);
    const event = {
      event_type: "payment.captured",
      data: { payment_id: payment.id },
    };
    await arc.receive("event-dedup", event);
    await arc.receive("event-dedup", event);
    await arc.tick();
    await arc.tick();
    expect(await db.select().from(arcPayEvents)).toHaveLength(1);
    expect((await service.getOrder(p.userId, p.order.id)).status).toBe("paid");
    expect(
      await db
        .select()
        .from(paymentEmails)
        .where(eq(paymentEmails.orderId, p.order.id)),
    ).toHaveLength(1);
  });
  it("accepts capture before the create response is saved without downgrading settlement", async () => {
    onCreate = async () => {
      const request = creates[0]!.body;
      const p = await remote(request.metadata.florelle_order_id);
      await arc.receive("early-event", {
        event_type: "payment.captured",
        data: { payment_id: p.id },
      });
      await arc.processEvents();
    };
    const p = await place();
    expect((await attempts(p.order.id)).state).toBe("paid");
    expect(p.paymentUrl).toBeUndefined();
  });
  it("flags refund for review without releasing paid stock", async () => {
    const p = await place();
    await remote(p.order.id);
    await arc.reconcile(p.order.id);
    await remote(p.order.id, "refunded");
    await arc.reconcile(p.order.id);
    expect(await attempts(p.order.id)).toMatchObject({
      state: "review",
      reviewReason: "refunded",
    });
    expect(await stock()).toBe(90);
    expect((await service.getOrder(p.userId, p.order.id)).status).toBe("paid");
  });

  it("returns the same Arc session for concurrent repeated checkout requests", async () => {
    const user = await addUser();
    await fillCart(user);
    const key = randomUUID();
    const results = await Promise.all([
      service.createOrder(user, input(), key),
      service.createOrder(user, input(), key),
    ]);
    expect(results[0]!.order.id).toBe(results[1]!.order.id);
    expect(creates).toHaveLength(1);
    expect(await stock()).toBe(90);
  });
  it("reconciles before offering a saved session from the resume endpoint", async () => {
    const p = await place();
    await remote(p.order.id);
    expect(await service.resume(p.userId, p.order.id)).toMatchObject({
      status: "paid",
      paymentUrl: null,
    });
  });
  it("rolls back all settlement effects when the integration outbox fails, then recovers", async () => {
    const p = await place();
    await remote(p.order.id);
    const broken = new ArcPayService(db, arc.client, {
      enqueueOrderEvent: async () => {
        throw Error("outbox unavailable");
      },
    });
    await expect(broken.reconcile(p.order.id)).rejects.toThrow(
      "outbox unavailable",
    );
    expect((await service.getOrder(p.userId, p.order.id)).status).toBe(
      "pending",
    );
    expect((await attempts(p.order.id)).state).toBe("ready");
    expect(
      await db
        .select()
        .from(paymentEmails)
        .where(eq(paymentEmails.orderId, p.order.id)),
    ).toHaveLength(0);
    await arc.reconcile(p.order.id);
    expect((await service.getOrder(p.userId, p.order.id)).status).toBe("paid");
  });
  it("sends the transactional paid email once across repeated worker ticks", async () => {
    const p = await place();
    await remote(p.order.id);
    await arc.reconcile(p.order.id);
    const delivered: unknown[] = [];
    const worker = new ArcPayService(db, arc.client, undefined, {
      sendOrderPaid: async (input) => {
        delivered.push(input);
      },
    });
    await worker.tick();
    await worker.tick();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      orderId: p.order.id,
      amountRub: "1885.63",
      idempotencyKey: "order-paid/" + p.order.id,
    });
  });
  it("retries a failed event processing attempt after a provider outage", async () => {
    const p = await place();
    const providerId = "payment-" + (await attempts(p.order.id)).id;
    await arc.receive("retry-event", {
      event_type: "payment.captured",
      data: { payment_id: providerId },
    });
    // Database timestamps have sub-millisecond precision and may be ahead of the app clock.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() - 1000);
    try {
      await arc.processEvents();
    } finally {
      vi.useRealTimers();
    }
    expect((await db.select().from(arcPayEvents))[0]).toMatchObject({
      status: "received",
      retryCount: 1,
    });
    await remote(p.order.id);
    await db.update(arcPayEvents).set({ nextAttemptAt: new Date(0) });
    await arc.processEvents();
    expect((await service.getOrder(p.userId, p.order.id)).status).toBe("paid");
  });

  it.each([{ min_amount: 200000 }, { max_amount: 100000 }])(
    "rejects unavailable amount before reserving stock or deleting cart: %j",
    async (limits) => {
      advertisedLimits = limits;
      const user = await addUser();
      await fillCart(user);
      await expect(
        service.createOrder(user, input(), randomUUID()),
      ).rejects.toMatchObject({ code: "PAYMENT_AMOUNT_UNAVAILABLE" });
      expect(await stock()).toBe(100);
      expect((await service.getCart(user)).items).toHaveLength(1);
      expect(
        await db.select().from(orders).where(eq(orders.buyerId, user)),
      ).toHaveLength(0);
      expect(creates).toHaveLength(0);
    },
  );
  it.each([false, true])(
    "flags partial refunds even when provider retains captured, alreadyPaid=%s",
    async (alreadyPaid) => {
      const p = await place();
      await remote(p.order.id);
      if (alreadyPaid) await arc.reconcile(p.order.id);
      await remote(p.order.id, "captured", { refunded_amount: 100 });
      await arc.reconcile(p.order.id);
      expect(await attempts(p.order.id)).toMatchObject({
        state: "review",
        reviewReason: "refunded",
      });
      expect(await stock()).toBe(90);
      expect((await service.getOrder(p.userId, p.order.id)).status).toBe(
        alreadyPaid ? "paid" : "pending",
      );
    },
  );
});
