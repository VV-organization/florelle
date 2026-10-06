import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql, desc } from "drizzle-orm";
import type { Database } from "../../shared/db/client";
import type { FxService } from "../../shared/currency/fx.service";
import { carts, cartItems } from "../../shared/db/schema/carts";
import { listings } from "../../shared/db/schema/listings";
import { products } from "../../shared/db/schema/products";
import { sellers } from "../../shared/db/schema/sellers";
import { users } from "../../shared/db/schema/users";
import { orders, orderItems } from "../../shared/db/schema/orders";
import { payments } from "../../shared/db/schema/payments";
import { checkoutAttempts } from "../../shared/db/schema/checkout";
import { storefrontSettings } from "../../shared/db/schema/storefront";
import { AppError } from "../../shared/middleware/error.middleware";
import {
  OrdersService,
  type OrdersServiceConfig,
  type OrdersIntegrationOutbox,
} from "../orders/orders.service";
import type { PaymentProvider } from "../payments/payment-provider";
import {
  calculateQuote,
  convertMinor,
  money,
  retailDefaults,
  type CheckoutInput,
  type DeliveryCountry,
} from "./pricing";
import type { MediaPhoto } from "../../shared/db/schema/storefront";

type Connection =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];
type SnapshotItem = {
  listingId: string;
  quantity: number;
  reservedStems: number;
  segment: "b2b" | "b2c";
  price: string;
  lineTotal: string;
  unitPriceUsd: string;
  totalPriceUsd: string;
  name: string;
  image: string;
  photo: MediaPhoto | null;
  sellerId: string;
  deliveryDate: string;
};
export type OrderSnapshot = Omit<ReturnType<typeof calculateQuote>, "items"> & {
  items: SnapshotItem[];
  delivery: CheckoutInput["delivery"];
  rates: Record<string, number>;
};
const fail = (code: string, message: string, status = 409) =>
  new AppError(status, code, message);
export class CommerceService {
  readonly legacy: OrdersService;
  constructor(
    private db: Database,
    private fx: FxService,
    private provider: PaymentProvider,
    private config: OrdersServiceConfig & { paymentsEnabled?: boolean },
    private outbox?: OrdersIntegrationOutbox,
  ) {
    this.legacy = new OrdersService(db, fx, provider, config, outbox);
  }
  async rates() {
    const values = await Promise.all(
      ["RUB", "KZT", "TRY"].map(
        async (c) => [c, await this.fx.getRate(c)] as const,
      ),
    );
    return { USD: 1, ...Object.fromEntries(values) };
  }
  async settings() {
    const rows = await this.db.select().from(storefrontSettings);
    const settings = Object.fromEntries(rows.map((x) => [x.key, x.value]));
    if (!Array.isArray(settings.delivery))
      throw fail("DELIVERY_NOT_CONFIGURED", "Доставка не настроена", 503);
    return {
      countries: settings.delivery as DeliveryCountry[],
      retailRates: (settings.retailRates ?? retailDefaults) as Record<
        string,
        number[]
      >,
    };
  }
  async user(id: string, connection: Connection = this.db) {
    const [user] = await connection
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!user || user.status !== "active")
      throw fail("UNAUTHORIZED", "Войдите в аккаунт", 401);
    return user;
  }
  async lines(userId: string, connection: Connection = this.db, lock = false) {
    const cartQuery = connection
      .select()
      .from(carts)
      .where(eq(carts.userId, userId));
    const [cart] = lock ? await cartQuery.for("update") : await cartQuery;
    if (!cart || cart.expiresAt <= new Date())
      throw fail(
        "CART_NOT_FOUND",
        "Корзина пуста или срок её хранения истёк",
        404,
      );
    const rows = await connection
      .select({
        cartItemId: cartItems.id,
        quantity: cartItems.quantity,
        listingId: listings.id,
        sellerId: listings.sellerId,
        boxQuantity: listings.boxQuantity,
        availableStems: listings.availableStems,
        priceCurrency: listings.priceCurrency,
        wholesalePrice: listings.wholesalePrice,
        retailPrice: listings.retailPrice,
        referencePrice: listings.referencePrice,
        sellerPriceUsd: listings.sellerPriceUsd,
        amsPriceUsd: listings.amsPriceUsd,
        deliveryDate: listings.deliveryDate,
        active: listings.isActive,
        productActive: products.isActive,
        sellerActive: sellers.isActive,
        productId: products.id,
        name: products.name,
        slug: products.slug,
        image: products.imageUrl,
        photo: products.photo,
        species: products.species,
        color: products.color,
        seller: sellers.name,
        sellerCountry: sellers.country,
        sellerVerified: sellers.verified,
      })
      .from(cartItems)
      .innerJoin(listings, eq(listings.id, cartItems.listingId))
      .innerJoin(products, eq(products.id, listings.productId))
      .innerJoin(sellers, eq(sellers.id, listings.sellerId))
      .where(eq(cartItems.cartId, cart.id))
      .orderBy(listings.id);
    if (lock) {
      for (const row of rows) {
        const [live] = await connection
          .select()
          .from(listings)
          .where(eq(listings.id, row.listingId))
          .for("update");
        if (!live) throw fail("LISTING_UNAVAILABLE", "Предложение недоступно");
        Object.assign(row, {
          availableStems: live.availableStems,
          priceCurrency: live.priceCurrency,
          wholesalePrice: live.wholesalePrice,
          retailPrice: live.retailPrice,
          referencePrice: live.referencePrice,
          sellerPriceUsd: live.sellerPriceUsd,
          boxQuantity: live.boxQuantity,
          active: live.isActive,
        });
      }
    }
    if (rows.some((x) => !x.active || !x.productActive || !x.sellerActive))
      throw fail("LISTING_UNAVAILABLE", "Предложение недоступно");
    return { cart, rows };
  }
  async getCart(userId: string, currency = "RUB", lang = "ru") {
    const user = await this.user(userId),
      segment = user.customerType === "individual" ? "b2c" : "b2b";
    const { cart, rows } = await this.lines(userId);
    const rates = await this.rates();
    let subtotal = 0;
    const display = (minor: number) =>
      money(convertMinor(money(minor), "RUB", currency, rates));
    const items = rows.map((r) => {
      const source = r.priceCurrency ?? "USD";
      const price =
        segment === "b2b"
          ? (r.wholesalePrice ?? r.sellerPriceUsd)
          : (r.retailPrice ??
            String(
              Number(r.wholesalePrice ?? r.sellerPriceUsd) * this.fx.markup,
            ));
      const perStem = convertMinor(price, source, currency, rates);
      const perUnit = convertMinor(
        price,
        source,
        "RUB",
        rates,
        segment === "b2b" ? r.boxQuantity : 1,
      );
      const line = perUnit * r.quantity;
      subtotal += line;
      return {
        id: r.cartItemId,
        quantity: r.quantity,
        lineTotal: display(line),
        listing: {
          id: r.listingId,
          product: {
            id: r.productId,
            name: r.name[lang === "en" ? "en" : "ru"],
            slug: r.slug,
            species: r.species,
            color: r.color,
            imageUrl: r.image,
          },
          seller: {
            id: r.sellerId,
            name: r.seller[lang === "en" ? "en" : "ru"],
            country: r.sellerCountry,
            verified: r.sellerVerified,
          },
          sellerPrice: money(perStem),
          amsPrice: money(
            convertMinor(
              r.referencePrice ?? r.amsPriceUsd,
              source,
              currency,
              rates,
            ),
          ),
          boxQuantity: r.boxQuantity,
          availableStock:
            segment === "b2b"
              ? Math.floor(r.availableStems / r.boxQuantity)
              : r.availableStems,
          deliveryDate: r.deliveryDate,
          image: r.image,
          photo: r.photo,
          unit: segment === "b2b" ? "box" : "stem",
        },
      };
    });
    const commission = Math.round(
      (subtotal * this.config.commissionPercent) / 100,
    );
    return {
      id: cart.id,
      expiresAt: cart.expiresAt.toISOString(),
      items,
      subtotal: display(subtotal),
      commission: display(commission),
      total: display(subtotal + commission),
      currency,
    };
  }
  async quote(userId: string, input: CheckoutInput) {
    const user = await this.user(userId);
    this.segment(user.customerType, input.segment);
    const [{ rows }, rates, settings] = await Promise.all([
      this.lines(userId),
      this.rates(),
      this.settings(),
    ]);
    return calculateQuote(
      rows,
      input,
      rates,
      settings.countries,
      this.config.commissionPercent,
      this.fx.markup,
      settings.retailRates,
    );
  }
  private segment(type: string, segment: string) {
    if ((type === "individual" ? "b2c" : "b2b") !== segment)
      throw fail(
        "SEGMENT_MISMATCH",
        "Тип аккаунта не соответствует формату покупки",
        403,
      );
  }
  async createOrder(
    userId: string,
    input: CheckoutInput,
    key: string,
    syntheticRunId?: string,
  ) {
    if (this.config.paymentsEnabled === false)
      throw fail(
        "PAYMENTS_NOT_CONFIGURED",
        "Онлайн-оплата пока недоступна",
        503,
      );
    const requestHash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const [rates, settings] = await Promise.all([
      this.rates(),
      this.settings(),
    ]);
    const orderId = await this.db.transaction(async (tx) => {
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");
      const user = await this.user(userId, tx);
      this.segment(user.customerType, input.segment);
      const [existing] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.buyerId, userId), eq(orders.checkoutKey, key)))
        .limit(1);
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw fail(
            "IDEMPOTENCY_CONFLICT",
            "Ключ уже использован для другого заказа",
          );
        return existing.id;
      }
      const { cart, rows } = await this.lines(userId, tx, true);
      const quote = calculateQuote(
        rows,
        input,
        rates,
        settings.countries,
        this.config.commissionPercent,
        this.fx.markup,
        settings.retailRates,
      );
      if (Number(quote.minimumMissingRub) > 0)
        throw fail("MINIMUM_ORDER", "Минимальная сумма заказа — 1 000 ₽", 400);
      const merchantOrderId = "FLR-" + randomUUID();
      const snapshot: OrderSnapshot = {
        ...quote,
        delivery: input.delivery,
        rates,
        items: quote.items.map((item, i) => ({
          ...item,
          name: rows[i]!.name.ru,
          image: rows[i]!.image,
          photo: rows[i]!.photo,
          sellerId: rows[i]!.sellerId,
          deliveryDate: rows[i]!.deliveryDate,
        })),
      };
      const [order] = await tx
        .insert(orders)
        .values({
          buyerId: userId,
          status: "pending",
          subtotalUsd: quote.subtotalUsd,
          commissionUsd: quote.commissionUsd,
          deliveryFeeUsd: quote.deliveryFeeUsd,
          totalUsd: quote.totalUsd,
          estimatedDeliveryStems: quote.estimatedStems,
          estimatedDeliveryWeightKg: quote.estimatedWeightKg,
          deliveryCountryCode: input.delivery!.countryCode,
          deliveryCityValue: input.delivery!.cityValue,
          displayCurrency: quote.currency,
          shippingAddress: input.shippingAddress,
          notes: input.notes ?? null,
          merchantOrderId,
          checkoutKey: key,
          requestHash,
          snapshot: snapshot as unknown as Record<string, unknown>,
          synthetic: !!syntheticRunId,
          scenarioRunId: syntheticRunId ?? null,
        })
        .returning();
      if (!order) throw Error("Order insert failed");
      const itemRows = await tx
        .insert(orderItems)
        .values(
          snapshot.items.map((i) => ({
            orderId: order.id,
            listingId: i.listingId,
            sellerId: i.sellerId,
            quantity: i.quantity,
            reservedStems: i.reservedStems,
            unitPriceUsd: i.unitPriceUsd,
            totalPriceUsd: i.totalPriceUsd,
            deliveryDate: i.deliveryDate,
            productName: i.name,
          })),
        )
        .returning();
      for (const item of snapshot.items)
        await tx
          .update(listings)
          .set({
            availableStems: sql`${listings.availableStems} - ${item.reservedStems}`,
          })
          .where(eq(listings.id, item.listingId));
      await tx.insert(checkoutAttempts).values({
        orderId: order.id,
        merchantOrderId,
        amountMinor: quote.paymentAmountMinor,
      });
      await this.outbox?.enqueueOrderEvent(tx, {
        eventType: "order.created",
        source: syntheticRunId ? "scenario" : "customer",
        order,
        items: itemRows,
        payment: { status: "pending", provider: "arcopay", paidAt: null },
      });
      await tx.delete(carts).where(eq(carts.id, cart.id));
      return order.id;
    });
    await this.advancePayment(orderId);
    const order = await this.getOrder(userId, orderId);
    return {
      order,
      ...(order.paymentUrl ? { paymentUrl: order.paymentUrl } : {}),
      paymentStatus: order.paymentStatus,
    };
  }
  async advancePayment(orderId: string) {
    let [attempt] = await this.db
      .select()
      .from(checkoutAttempts)
      .where(eq(checkoutAttempts.orderId, orderId))
      .limit(1);
    if (!attempt) return;
    if (["paid", "failed", "ready", "review"].includes(attempt.state)) return;
    // A crash after beginning /create has an unknown outcome. Never call it twice.
    if (attempt.state === "creating") {
      if (!attempt.leaseUntil || attempt.leaseUntil < new Date())
        await this.db
          .update(checkoutAttempts)
          .set({ state: "review", updatedAt: new Date() })
          .where(
            and(
              eq(checkoutAttempts.id, attempt.id),
              eq(checkoutAttempts.state, "creating"),
            ),
          );
      return;
    }
    if (attempt.state === "created") {
      const [claim] = await this.db
        .update(checkoutAttempts)
        .set({
          state: "creating",
          leaseUntil: new Date(Date.now() + 60000),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(checkoutAttempts.id, attempt.id),
            eq(checkoutAttempts.state, "created"),
          ),
        )
        .returning();
      if (!claim) return;
      const [order] = await this.db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);
      if (!order) return;
      try {
        if (!this.provider.createPaymentOrder)
          throw Error("Provider has no durable creation API");
        const result = await this.provider.createPaymentOrder({
          merchantOrderId: claim.merchantOrderId,
          amountUsd: order.totalUsd,
          amountMinor: claim.amountMinor,
          description: "Florelle order " + order.id,
          callbackUrl: this.config.callbackUrl,
          successUrl: this.config.successUrl.replace("{orderId}", orderId),
          failUrl: this.config.failUrl.replace("{orderId}", orderId),
        });
        if (!result.externalId?.trim())
          throw Error("Missing provider identity");
        await this.db.transaction(async (tx) => {
          const [current] = await tx
            .select()
            .from(checkoutAttempts)
            .where(eq(checkoutAttempts.id, claim.id))
            .for("update");
          if (!current) throw Error("Checkout intent disappeared");
          if (current.externalId) {
            if (current.externalId !== result.externalId)
              throw Error("Provider identity conflict");
            return; // A verified callback already persisted this identity, possibly settled it.
          }
          if (!["creating", "review"].includes(current.state)) return;
          await tx.insert(payments).values({
            orderId,
            provider: "arcopay",
            externalId: result.externalId,
            amountUsd: order.totalUsd,
            status: "pending",
          });
          await tx
            .update(checkoutAttempts)
            .set({
              state: "created_external",
              externalId: result.externalId,
              leaseUntil: null,
              updatedAt: new Date(),
            })
            .where(eq(checkoutAttempts.id, claim.id));
        });
      } catch {
        await this.db
          .update(checkoutAttempts)
          .set({ state: "review", leaseUntil: null, updatedAt: new Date() })
          .where(
            and(
              eq(checkoutAttempts.id, claim.id),
              eq(checkoutAttempts.state, "creating"),
            ),
          );
        return;
      }
      [attempt] = await this.db
        .select()
        .from(checkoutAttempts)
        .where(eq(checkoutAttempts.id, claim.id))
        .limit(1);
      if (!attempt) return;
    }
    if (attempt.state !== "created_external" || !attempt.externalId) return;
    const [lease] = await this.db
      .update(checkoutAttempts)
      .set({ leaseUntil: new Date(Date.now() + 30000) })
      .where(
        and(
          eq(checkoutAttempts.id, attempt.id),
          eq(checkoutAttempts.state, "created_external"),
          sql`(${checkoutAttempts.leaseUntil} IS NULL OR ${checkoutAttempts.leaseUntil} < now())`,
        ),
      )
      .returning();
    if (!lease) return;
    try {
      const result = await this.provider.getPaymentUrl({
        externalId: attempt.externalId,
        description: "Florelle order " + orderId,
      });
      const url = new URL(result.paymentUrl);
      if (url.protocol !== "https:" || url.username || url.password)
        throw Error("Unsafe payment URL");
      await this.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(checkoutAttempts)
          .set({
            state: "ready",
            paymentUrl: url.toString(),
            leaseUntil: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(checkoutAttempts.id, attempt!.id),
              eq(checkoutAttempts.state, "created_external"),
            ),
          )
          .returning();
        if (!updated) return;
        const [order] = await tx
          .select()
          .from(orders)
          .where(eq(orders.id, orderId));
        if (!order) return;
        const items = await tx
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, orderId));
        if (order.synthetic)
          await tx
            .update(orders)
            .set({ scenarioPaymentUrlHost: url.host })
            .where(eq(orders.id, orderId));
        await this.outbox?.enqueueOrderEvent(tx, {
          eventType: "order.payment_reached",
          source: order.synthetic ? "scenario" : "customer",
          order,
          items,
          payment: { status: "pending", provider: "arcopay", paidAt: null },
        });
      });
    } catch {
      await this.db
        .update(checkoutAttempts)
        .set({ leaseUntil: null, updatedAt: new Date() })
        .where(
          and(
            eq(checkoutAttempts.id, attempt.id),
            eq(checkoutAttempts.state, "created_external"),
          ),
        );
    }
  }
  async getOrder(userId: string, id: string) {
    const [order] = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.buyerId, userId)))
      .limit(1);
    if (!order) throw fail("ORDER_NOT_FOUND", "Заказ не найден", 404);
    const [attempt] = await this.db
      .select()
      .from(checkoutAttempts)
      .where(eq(checkoutAttempts.orderId, id))
      .limit(1);
    const snapshot = order.snapshot as unknown as OrderSnapshot | null;
    return {
      ...order,
      ...snapshot,
      id: order.id,
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      paymentUrl:
        order.status === "pending" ? (attempt?.paymentUrl ?? null) : null,
      paymentStatus: ["paid", "shipped", "delivered"].includes(order.status)
        ? "paid"
        : order.status === "cancelled"
          ? "failed"
          : attempt?.state === "review"
            ? "review"
            : "pending",
      delivery: snapshot?.delivery,
      shippingAddress: order.shippingAddress,
    };
  }
  async listOrders(userId: string, page = 1, limit = 20) {
    const counts = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.buyerId, userId), eq(orders.synthetic, false)));
    const count = counts[0]?.count ?? 0;
    const rows = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.buyerId, userId), eq(orders.synthetic, false)))
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    return {
      data: await Promise.all(rows.map((r) => this.getOrder(userId, r.id))),
      meta: { total: count!, page, limit, pages: Math.ceil(count! / limit) },
    };
  }
  async resume(userId: string, id: string) {
    await this.getOrder(userId, id);
    await this.advancePayment(id);
    return this.getOrder(userId, id);
  }
  async recoverPaymentLinks() {
    const rows = await this.db
      .select({ orderId: checkoutAttempts.orderId })
      .from(checkoutAttempts)
      .where(
        sql`${checkoutAttempts.state} in ('created','created_external','creating')`,
      )
      .limit(25);
    for (const row of rows) await this.advancePayment(row.orderId);
  }
}
