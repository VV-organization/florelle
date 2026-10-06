# Orders module — design spec

**Date:** 2026-04-10
**Modules:** `src/modules/orders` + `src/modules/payments`
**Status:** approved (pending implementation)

## 1. Context

The orders module is the third and most complex feature module. It
covers cart management, order creation with transactional stock check
and price snapshots, commission calculation, a state machine for order
lifecycle, and integration with a payment provider (mocked for MVP,
replaceable with ArcoPay later).

The `payments/` directory, previously reserved for ArcoPay integration,
is filled in during this task with a provider-agnostic interface and a
mock implementation. Real ArcoPay integration (based on the shootbaam
reference) becomes a drop-in replacement: change one line in `app.ts`
to swap `MockPaymentProvider` for `ArcoPayPaymentProvider`.

Key domain rules from `CLAUDE.md` that this module enforces:
- **Price snapshot** — order_items hold frozen prices and delivery
  dates at order creation; never re-read from listings afterward
- **Commission** — `subtotal_usd × PLATFORM_COMMISSION_PERCENT / 100`,
  rounded to 2 decimal places, stored on the order
- **Cart expiry** — 24h from creation; enforced on every cart read
- **Stock check** — transactional `SELECT FOR UPDATE` + decrement,
  rollback on insufficient stock, 409 response

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Scope | Orders + cart + payments (mock) in one spec | Orders and payments are tightly coupled via the PaymentProvider interface; splitting would require a stub provider anyway |
| Payment integration | Mock provider with swappable interface | Full order flow testable without real API keys; drop-in replacement when ArcoPay keys land |
| Shipping address | Minimal structured: `address` + `contactName` + `contactPhone` | Compromise between free-form and full address parsing; sufficient for MVP B2B use |
| State machine | Full implementation per shootbaam pattern | `canTransition()` helper file is in `CLAUDE.md` project structure; only ~15 lines |
| Cart-order separation | Single `OrdersService` class for both | Cart and order logic tightly coupled (`createOrder` reads cart); splitting creates circular deps |
| Failure on payment creation | Order stays in `pending` without paymentUrl; return 502 | Matches shootbaam pattern; admin can manually retry/cancel |
| Stock restoration on failed payment | Webhook increments `available_stock` back | Simple, no compensating transaction needed |

## 3. Payment provider abstraction

### Interface

```ts
interface PaymentProvider {
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>;
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
  parseWebhookPayload(body: unknown): WebhookPayload;
}

type CreatePaymentParams = {
  merchantOrderId: string;
  amountUsd: string;
  description: string;
  buyerEmail?: string;
  callbackUrl: string;
  successUrl: string;
  failUrl: string;
};

type CreatePaymentResult = {
  externalId: string;
  paymentUrl: string;
};

type WebhookPayload = {
  merchantOrderId: string;
  externalId: string;
  status: 'paid' | 'failed';
};
```

### `MockPaymentProvider` implementation

```ts
class MockPaymentProvider implements PaymentProvider {
  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    return {
      externalId: `mock-${randomUUID()}`,
      paymentUrl: `https://mock-pay.example.com/${params.merchantOrderId}`,
    };
  }

  verifyWebhookSignature(): boolean {
    return true;
  }

  parseWebhookPayload(body: unknown): WebhookPayload {
    const data = body as Record<string, unknown>;
    return {
      merchantOrderId: String(data.merchantOrderId),
      externalId: String(data.externalId),
      status: data.status === 'paid' ? 'paid' : 'failed',
    };
  }
}
```

### Future ArcoPayPaymentProvider

When ArcoPay integration lands (separate task), a new class implements
the same interface:
- `createPayment` → POST to `https://api.arcopay.tech/api/v1/...` with
  `MerchantOrderId`, `Currency`, `PaymentTypes`, `CallbackUrl`, etc.
  (see shootbaam `backend/src/services/orderService.ts`)
- `verifyWebhookSignature` → RSA-SHA1 against ArcoPay's public key
  (see shootbaam `backend/src/arcopay/verify.ts`)
- `parseWebhookPayload` → map `CHARGED` / `IPS_ACCEPTED` → `'paid'`;
  `DECLINED` / `EXPIRED` → `'failed'`

Swap point: `app.ts` line `new MockPaymentProvider()` → `new ArcoPayPaymentProvider(config)`.

## 4. Cart flow

### Model

One cart per user (`carts.userId` has UNIQUE constraint). Cart is
created on first `POST /cart/items`. `expires_at = NOW() + 24h` at
creation.

### Cart expiry enforcement

Every cart read checks `expires_at`. If `NOW() > expires_at`, treat as
not-found (404 with `CART_EXPIRED` code). On next write (e.g.,
`POST /cart/items`), the expired cart is physically deleted and a new
one is created. This works around the `userId` UNIQUE constraint.

### Endpoints (all auth-required)

#### `POST /cart/items`

Add a listing to the cart. Creates the cart if the user has none (or
if previous cart is expired and needs recreation).

Request:
```ts
{ listingId: string (uuid), quantityBoxes: number (positive int) }
```

Response 201:
```ts
{ id: string, listingId: string, quantityBoxes: number, createdAt: string }
```

Errors:
- 404 `CART_EXPIRED` if current cart expired (also deletes it so retry
  succeeds)
- 404 listing not found or `is_active = false` → `LISTING_UNAVAILABLE`
- 409 listing already in cart → `ITEM_ALREADY_IN_CART`

Note: stock is NOT checked when adding to cart. Cart is a wishlist;
stock check happens only at `POST /orders`.

#### `GET /cart?currency=EUR`

Returns the cart with live prices converted to display currency.

Response 200:
```ts
{
  id: string,
  expiresAt: string,
  items: [
    {
      id: string,
      listing: { /* listing-centric shape with product + seller */ },
      quantityBoxes: number,
      lineTotal: string  // listing.sellerPrice × quantityBoxes
    }
  ],
  subtotal: string,     // sum of lineTotals
  commission: string,   // subtotal × commissionPercent / 100
  total: string         // subtotal + commission
}
```

Errors:
- 404 `CART_NOT_FOUND` if user has no cart
- 404 `CART_EXPIRED` if cart expired

Prices are live (from listings), converted via FxService, returned as
decimal strings in display currency.

#### `PATCH /cart/items/:id`

Update quantity for a specific cart item.

Request:
```ts
{ quantityBoxes: number (positive int) }
```

Response 200: updated cart item.

Errors:
- 404 `CART_ITEM_NOT_FOUND` (not found OR not owned by user)

#### `DELETE /cart/items/:id`

Remove an item from the cart.

Response: 204.

Errors: 404 `CART_ITEM_NOT_FOUND`.

## 5. Order creation flow

`POST /orders` is the most complex endpoint — it enforces 4 business
rules in a single request.

### Request

```ts
{
  shippingAddress: {
    address: string (min 10 chars),
    contactName: string (min 2 chars),
    contactPhone: string (min 5 chars),
  },
  notes?: string (max 1000 chars),
  displayCurrency?: 'USD' | 'EUR' | 'RUB'  // default USD
}
```

### Response 201

```ts
{
  order: {
    id: string,
    status: 'pending',
    subtotalUsd: string,
    commissionUsd: string,
    totalUsd: string,
    displayCurrency: string,
    shippingAddress: { ... },
    notes: string | null,
    items: [
      {
        id: string,
        listingId: string,
        sellerId: string,
        quantityBoxes: number,
        unitPriceUsd: string,   // snapshot
        totalPriceUsd: string,  // snapshot
        deliveryDate: string    // snapshot
      }
    ],
    createdAt: string
  },
  paymentUrl: string
}
```

### Flow (step by step)

1. **Load cart** for `request.user.id`. If not found → 404
   `CART_NOT_FOUND`. If expired → 404 `CART_EXPIRED`. If empty → 400
   `EMPTY_CART`.

2. **Begin DB transaction.**

3. **For each cart item, lock and validate the listing:**
   ```sql
   SELECT * FROM listings WHERE id = $cart_item.listing_id FOR UPDATE
   ```
   - If `is_active = false` → rollback, throw `ListingUnavailableError`
     (with `listingId` in details)
   - If `available_stock < cart_item.quantity_boxes` → rollback, throw
     `InsufficientStockError` (with `listingId`, `available`,
     `requested` in details)

4. **Decrement stock:**
   ```sql
   UPDATE listings SET available_stock = available_stock - $quantity
   WHERE id = $listing_id
   ```

5. **Compute totals from locked listing rows:**
   - `subtotal_usd = SUM(listing.seller_price_usd × cart_item.quantity_boxes)`
   - `commission_usd = (subtotal_usd × commissionPercent / 100).toFixed(2)`
   - `total_usd = subtotal_usd + commission_usd`

6. **Insert order** (status: `pending`, with shipping address, notes,
   display currency, computed totals). Keep the generated UUID.

7. **Insert order_items** (batch, one per cart item). Each item holds:
   - `listing_id`, `seller_id` from the locked listing
   - `quantity_boxes` from cart
   - `unit_price_usd` = SNAPSHOT of `listing.seller_price_usd`
   - `total_price_usd` = `unit_price_usd × quantity_boxes`
   - `delivery_date` = SNAPSHOT of `listing.delivery_date`

8. **Commit transaction.**

9. **Delete cart** (outside transaction — non-critical; worst case,
   cart expires in 24h). `DELETE FROM carts WHERE id = $cart.id`
   cascades to `cart_items`.

10. **Create payment via provider:**
    ```ts
    const merchantOrderId = generateMerchantOrderId();
    const { externalId, paymentUrl } = await paymentProvider.createPayment({
      merchantOrderId,
      amountUsd: order.total_usd,
      description: `Flowers order ${order.id}`,
      buyerEmail: request.user.email,
      callbackUrl: config.callbackUrl,
      successUrl: config.successUrl.replace('{orderId}', order.id),
      failUrl: config.failUrl.replace('{orderId}', order.id),
    });
    ```

    If `createPayment` throws → order stays in `pending` without
    merchantOrderId; return 502 `PAYMENT_CREATION_FAILED`. Stock was
    already decremented inside the committed transaction — admin can
    cancel manually later.

11. **Insert payment row:**
    ```ts
    {
      order_id: order.id,
      provider: 'arcopay',
      external_id: externalId,
      amount_usd: order.total_usd,
      status: 'pending',
    }
    ```

12. **Update order with merchantOrderId:**
    ```sql
    UPDATE orders SET merchant_order_id = $merchantOrderId
    WHERE id = $order.id
    ```

13. **Return** `{ order, paymentUrl }`.

### `generateMerchantOrderId`

```ts
function generateMerchantOrderId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = randomUUID().slice(0, 8).toUpperCase();
  return `FL-${date}-${random}`;  // e.g. FL-20260410-A1B2C3D4
}
```

`FL-` prefix (Flowers) vs shootbaam's `IS-`. `payments.external_id`
UNIQUE constraint prevents duplicate-payment race conditions.

### Schema change

Add `merchant_order_id text UNIQUE` column to `orders` table. Generate
migration via `pnpm db:generate`, apply via `pnpm db:migrate`.

## 6. Order state machine + webhook

### State machine

```
pending ──→ paid ──→ shipped ──→ delivered
  │           │
  └──→ cancelled ←──┘
```

File `orders.state-machine.ts`:
```ts
const TRANSITIONS: Record<string, string[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

export function canTransition(from: string, to: string): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
```

Transitions triggered by:
- `pending → paid` — webhook on payment success
- `pending → cancelled` — webhook on payment failure/expiry (or future
  buyer-cancel endpoint)
- `paid → shipped` — admin action (future)
- `paid → cancelled` — admin refund (future)
- `shipped → delivered` — admin action (future)

### Webhook endpoint

`POST /api/v1/payments/callback` — **public** (no auth), with signature
verification delegated to the provider.

Flow:
1. `provider.verifyWebhookSignature(rawBody, headers.signature)` — mock
   always returns true. ArcoPay implementation uses RSA-SHA1.
2. `provider.parseWebhookPayload(body)` → normalized `WebhookPayload`.
3. Find payment by `external_id` (UNIQUE). Not found → 200 OK with
   warning log (prevents provider retries).
4. Load order by `payment.order_id`.
5. Check `canTransition(order.status, newStatus)` from state machine.
   If false (e.g., already `paid` or `cancelled`) → 200 OK, idempotent
   no-op.
6. Apply transition:
   - If `paid`:
     - `UPDATE orders SET status = 'paid'`
     - `UPDATE payments SET status = 'completed'`
   - If `failed` (maps to `cancelled`):
     - `UPDATE orders SET status = 'cancelled'`
     - `UPDATE payments SET status = 'failed'`
     - Restore stock: for each `order_items` row,
       `UPDATE listings SET available_stock = available_stock + quantity_boxes`
       (best-effort; log warning on failure, do not throw)
7. **Always return 200 OK** — even on internal errors. This prevents
   provider retry loops.

### Raw body capture

Fastify's default JSON parser strips the raw body. For RSA signature
verification (future ArcoPay) we need the original bytes. Register a
content-type parser on the webhook route:

```ts
app.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  (req, body, done) => {
    try {
      const parsed = JSON.parse(body.toString());
      (req as unknown as { rawBody: Buffer }).rawBody = body;
      done(null, parsed);
    } catch (err) {
      done(err as Error);
    }
  }
);
```

Scoped to the webhook route via a sub-plugin so it doesn't affect
other routes.

## 7. Endpoint contracts

All cart and order endpoints require `preHandler: [app.authenticate]`.
The webhook endpoint is public.

### Cart (`/api/v1/cart`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/cart/items` | yes | Add listing to cart |
| GET | `/cart?currency=` | yes | Get cart with computed totals |
| PATCH | `/cart/items/:id` | yes | Update quantity |
| DELETE | `/cart/items/:id` | yes | Remove item |

### Orders (`/api/v1/orders`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/orders` | yes | Create order from cart |
| GET | `/orders?page=&limit=` | yes | Buyer's order history (summary) |
| GET | `/orders/:id` | yes | Order detail with items |

### Payments webhook (`/api/v1/payments`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/payments/callback` | no | Provider webhook |

Full request/response shapes per section 5 (orders) and 4 (cart).

Order history (`GET /orders`) returns summaries only:
```ts
{
  data: [
    {
      id: string,
      status: string,
      totalUsd: string,
      displayCurrency: string,
      createdAt: string
    }
  ],
  meta: { total, page, limit, pages }
}
```

Stored order prices stay in USD — display currency is a label for the
frontend. Unlike catalog, we never re-convert stored values (business
rule: stored values are immutable snapshots).

## 8. File structure

### New files

```
src/modules/orders/
├── orders.router.ts                   # Cart + order routes
├── orders.service.ts                  # OrdersService class
├── orders.schema.ts                   # Zod schemas
├── orders.errors.ts                   # Typed errors
├── orders.state-machine.ts            # canTransition + TRANSITIONS
└── __tests__/
    ├── orders.service.test.ts         # 21 tests
    └── orders.state-machine.test.ts   # 5 tests

src/modules/payments/
├── payments.router.ts                 # POST /payments/callback
├── payments.service.ts                # WebhookService
├── payment-provider.ts                # PaymentProvider interface + types
├── mock-payment-provider.ts           # MockPaymentProvider
└── __tests__/
    ├── payments.service.test.ts       # 6 tests
    └── mock-payment-provider.test.ts  # 3 tests
```

### Modified files

```
src/shared/db/schema/orders.ts         # Add merchant_order_id column
src/shared/db/migrations/0001_*.sql    # Generated migration
src/app.ts                             # Wire PaymentProvider, OrdersService, WebhookService
```

### `OrdersService` shape

```ts
class OrdersService {
  constructor(
    private readonly db: Database,
    private readonly fxService: FxService,
    private readonly paymentProvider: PaymentProvider,
    private readonly config: OrdersServiceConfig,
  ) {}

  // Cart
  async addCartItem(userId: string, input: AddCartItemBody): Promise<CartItemResponse>
  async getCart(userId: string, currency: string): Promise<CartResponse>
  async updateCartItem(userId: string, itemId: string, input: UpdateCartItemBody): Promise<CartItemResponse>
  async removeCartItem(userId: string, itemId: string): Promise<void>

  // Orders
  async createOrder(userId: string, userEmail: string, input: CreateOrderBody): Promise<CreateOrderResponse>
  async listOrders(userId: string, page: number, limit: number): Promise<PaginatedResponse<OrderSummary>>
  async getOrderById(userId: string, orderId: string): Promise<OrderDetail>
}

type OrdersServiceConfig = {
  commissionPercent: number;
  cartTtlHours: number;
  callbackUrl: string;
  successUrl: string;
  failUrl: string;
};
```

### `WebhookService` shape

```ts
class WebhookService {
  constructor(
    private readonly db: Database,
    private readonly paymentProvider: PaymentProvider,
  ) {}

  async handleCallback(
    rawBody: Buffer,
    signature: string,
    body: unknown,
  ): Promise<void>
}
```

### Dependency graph

```
app.ts
  → PaymentProvider instance (MockPaymentProvider)
  → OrdersService(db, fxService, paymentProvider, config)
  → WebhookService(db, paymentProvider)
  → buildOrdersRouter(ordersService) with app.authenticate
  → buildPaymentsRouter(webhookService)
```

## 9. Error handling

All errors extend `AppError` from `shared/middleware/error.middleware.ts`.
Global handler already converts them to JSON responses.

| Error | Status | Code | Trigger |
|---|---|---|---|
| `CartNotFoundError` | 404 | `CART_NOT_FOUND` | User has no cart |
| `CartExpiredError` | 404 | `CART_EXPIRED` | `expires_at < NOW()` |
| `EmptyCartError` | 400 | `EMPTY_CART` | `POST /orders` with 0 cart items |
| `ItemAlreadyInCartError` | 409 | `ITEM_ALREADY_IN_CART` | `POST /cart/items` duplicate listing |
| `CartItemNotFoundError` | 404 | `CART_ITEM_NOT_FOUND` | `PATCH`/`DELETE` not found or not owned |
| `ListingUnavailableError` | 409 | `LISTING_UNAVAILABLE` | Listing inactive at checkout. Details: `{ listingId }` |
| `InsufficientStockError` | 409 | `INSUFFICIENT_STOCK` | Available < requested. Details: `{ listingId, available, requested }` |
| `OrderNotFoundError` | 404 | `ORDER_NOT_FOUND` | `GET /orders/:id` not found or not owned |
| `PaymentCreationFailedError` | 502 | `PAYMENT_CREATION_FAILED` | Provider `createPayment` threw |
| `InvalidOrderTransitionError` | 409 | `INVALID_ORDER_TRANSITION` | Admin transition rejected by state machine (future use; webhook swallows silently) |

### Edge cases

| Scenario | Behavior |
|---|---|
| `POST /cart/items` with stock=0 listing | Accepted (wishlist semantics) |
| Listing becomes inactive between add-to-cart and checkout | `LISTING_UNAVAILABLE` at `POST /orders` |
| Concurrent `POST /orders` for same user | PG row locks serialize; second sees decremented stock |
| Payment provider throws on `createPayment` | Order in `pending` without paymentUrl; 502 returned; stock stays decremented |
| Webhook for unknown payment | 200 OK + warning log |
| Webhook duplicate (order already `paid`) | 200 OK, idempotent skip |
| Webhook `failed` for `paid` order | State machine blocks, 200 OK skip |
| Stock restoration on failed webhook partially fails | Warning log, 200 OK (admin fix) |
| `GET /orders/:id` for another user's order | 404 (not 403 — do not reveal existence) |

### Transaction boundaries

Inside `db.transaction`:
- `SELECT ... FOR UPDATE` on listings
- Stock decrement (`UPDATE listings`)
- Order insert
- Order items insert

Outside transaction:
- Cart deletion
- Payment creation (external API)
- Payment row insert
- Order `merchantOrderId` update

If the external payment creation fails after commit, the order stays in
`pending` with inconsistent partial state. This is acceptable for MVP:
the stock is correctly decremented, the buyer sees an error, an admin
can reconcile.

## 10. Testing strategy

### `orders.state-machine.test.ts` — 5 tests

Pure functions, no mocks:
1. `canTransition('pending', 'paid')` → true
2. `canTransition('pending', 'cancelled')` → true
3. `canTransition('paid', 'shipped')` → true
4. `canTransition('shipped', 'delivered')` → true
5. Invalid transitions all return false: `delivered → X`, `cancelled → X`,
   `paid → pending`, `pending → shipped`, `pending → delivered`,
   `paid → delivered`

### `orders.service.test.ts` — 21 tests

Mocks: `Database` (chainable with `transaction` support), `FxService`
(mocked), `PaymentProvider` (`vi.fn` for all three methods).

**`addCartItem` (3):**
1. Happy path — creates cart + item
2. Listing not found → `ListingUnavailableError`
3. Duplicate listing → `ItemAlreadyInCartError`

**`getCart` (4):**
4. Happy path — items with FX-converted prices, subtotal, commission, total
5. No cart → `CartNotFoundError`
6. Expired cart → `CartExpiredError`
7. Commission calculation correctness (`subtotal × 12 / 100`, rounded)

**`updateCartItem` (2):**
8. Happy path
9. Item not owned → `CartItemNotFoundError`

**`removeCartItem` (1):**
10. Happy path

**`createOrder` (7):**
11. Happy path — snapshots, commission, payment, cart deletion
12. Empty cart → `EmptyCartError`
13. Expired cart → `CartExpiredError`
14. Listing inactive → `ListingUnavailableError` with listingId
15. Insufficient stock → `InsufficientStockError` with listingId/available/requested
16. Payment provider throws → `PaymentCreationFailedError`
17. Price snapshot verification — `unit_price_usd` equals `listing.seller_price_usd`
    from query result (regression guard against live-read bug)

**`listOrders` (2):**
18. Happy path with pagination
19. Empty list

**`getOrderById` (2):**
20. Happy path
21. Order of another user → `OrderNotFoundError`

### `payments.service.test.ts` — 6 tests

Mocks: `Database`, `PaymentProvider`.

22. `paid` webhook → order `paid`, payment `completed`
23. `failed` webhook → order `cancelled`, payment `failed`, stock restored
24. Duplicate webhook (order already `paid`) → idempotent no-op
25. Invalid signature (mock returns false) → rejected, no DB updates
26. Payment not found → no throw, warning logged, returns normally
27. State machine blocks transition → swallowed, no DB updates

### `mock-payment-provider.test.ts` — 3 tests

28. `createPayment` returns `{ externalId: 'mock-...', paymentUrl: 'https://mock-pay...' }`
29. `verifyWebhookSignature` always returns true
30. `parseWebhookPayload` maps `{ status: 'paid' }` → `'paid'` and
    `{ status: 'failed' }` → `'failed'`

### Mock strategy

For `createOrder`, mock `db.transaction`:
```ts
const dbMock = {
  transaction: vi.fn().mockImplementation(async (fn) => fn(dbMock)),
  // ... chainable methods
};
```
This lets transaction-scoped code run inside the mock without real
locking. Real transaction semantics are validated by the smoke test.

For `PaymentProvider`, all three methods are `vi.fn()` — no real HTTP,
no real RSA.

### Total

**35 new unit tests** for this module (5 state machine + 21 OrdersService
+ 6 WebhookService + 3 MockPaymentProvider). Plus the existing 45 (auth,
catalog, FxService). After orders: **80 total**.

### What we do NOT test

- Raw body capture (Fastify infrastructure)
- RSA-SHA1 verification (MockPaymentProvider always true; ArcoPay
  covered separately when implemented)
- Real DB transaction isolation (mocked; smoke test validates)
- HTTP integration via `fastify.inject` (covered by smoke test)

## 11. Out of scope

Intentionally excluded from this plan:
- Real ArcoPay integration (separate task — `ArcoPayPaymentProvider`
  implementing the same interface)
- Admin endpoints for order state transitions (`PATCH /admin/orders/:id`)
- Buyer-initiated order cancellation before payment
- Order retry flow (resend payment link for orders stuck in `pending`)
- Cart cleanup cron for expired carts
- Order confirmation emails (notifications module is a separate feature)
- Inventory reservations with TTL (we lock per-transaction, not per-session)
- Split shipping (multiple sellers per order — orders_items already
  support this via `seller_id`, but no UI/logic to display it yet)
- Refunds
