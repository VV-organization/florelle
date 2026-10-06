# Orders Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the buyer-facing orders flow — 4 cart endpoints + 3 order endpoints + 1 payment webhook — with transactional stock check, price snapshots, commission calculation, and a swappable PaymentProvider abstraction (mock now, ArcoPay later).

**Architecture:** `OrdersService` orchestrates cart CRUD and order creation. `POST /orders` runs DB transaction (SELECT FOR UPDATE → decrement → insert) then calls the injected `PaymentProvider`. `WebhookService` in the payments module handles provider callbacks, updates order state via a state machine, and restores stock on failure. `MockPaymentProvider` implements the interface with no external calls; a future `ArcoPayPaymentProvider` drops in by changing one line in `app.ts`.

**Tech Stack:** Fastify 4, `fastify-type-provider-zod`, Drizzle ORM + `postgres.js` (with `db.transaction` + `.for('update')`), `ioredis`, Zod 3, Vitest.

**Spec:** [`backend/docs/superpowers/specs/2026-04-10-orders-module-design.md`](../specs/2026-04-10-orders-module-design.md)

**Assumed workdir for all commands:** `flowers/backend/`.

---

## File structure

| File | Action | Purpose |
|---|---|---|
| `src/shared/db/schema/orders.ts` | Modify | Add `merchant_order_id` UNIQUE column |
| `src/shared/db/migrations/0001_*.sql` | Create | Auto-generated migration |
| `src/modules/orders/orders.errors.ts` | Create | 10 typed errors extending AppError |
| `src/modules/orders/orders.state-machine.ts` | Create | `canTransition()` + `TRANSITIONS` map |
| `src/modules/orders/__tests__/orders.state-machine.test.ts` | Create | 5 state machine tests |
| `src/modules/orders/orders.schema.ts` | Create | Zod schemas for cart + order endpoints |
| `src/modules/payments/payment-provider.ts` | Create | PaymentProvider interface + types |
| `src/modules/payments/mock-payment-provider.ts` | Create | MockPaymentProvider implementation |
| `src/modules/payments/__tests__/mock-payment-provider.test.ts` | Create | 3 mock provider tests |
| `src/modules/orders/orders.service.ts` | Create | OrdersService (7 public methods) |
| `src/modules/orders/__tests__/orders.service.test.ts` | Create | 21 OrdersService tests |
| `src/modules/payments/payments.service.ts` | Create | WebhookService |
| `src/modules/payments/__tests__/payments.service.test.ts` | Create | 6 WebhookService tests |
| `src/modules/orders/orders.router.ts` | Rewrite | 7 routes (cart + orders) |
| `src/modules/payments/payments.router.ts` | Create | 1 webhook route with raw body parser |
| `src/app.ts` | Modify | Create PaymentProvider + OrdersService + WebhookService, register routers |

---

## Task 1: Add `merchant_order_id` column + migration

**Files:**
- Modify: `src/shared/db/schema/orders.ts`
- Create: `src/shared/db/migrations/0001_*.sql`

- [ ] **Step 1: Read current orders.ts**

Run:
```bash
cat src/shared/db/schema/orders.ts
```
Note the existing columns to understand where to insert the new one.

- [ ] **Step 2: Add merchantOrderId column**

In `src/shared/db/schema/orders.ts`, inside the `orders` pgTable definition, add after `notes`:
```ts
merchantOrderId: text('merchant_order_id').unique(),
```

The full `orders` table should now look like:
```ts
export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  buyerId: uuid('buyer_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  status: orderStatusEnum('status').notNull().default('pending'),
  subtotalUsd: numeric('subtotal_usd', { precision: 12, scale: 2 }).notNull(),
  commissionUsd: numeric('commission_usd', { precision: 12, scale: 2 }).notNull(),
  totalUsd: numeric('total_usd', { precision: 12, scale: 2 }).notNull(),
  displayCurrency: currencyEnum('display_currency').notNull().default('USD'),
  shippingAddress: jsonb('shipping_address').notNull(),
  notes: text('notes'),
  merchantOrderId: text('merchant_order_id').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3: Generate migration**

```bash
pnpm db:generate
```
Expected: creates `src/shared/db/migrations/0001_<random_name>.sql` containing an `ALTER TABLE orders ADD COLUMN merchant_order_id text UNIQUE` statement.

- [ ] **Step 4: Apply migration**

```bash
pnpm db:migrate
```
Expected: migration applied, no errors. Verify:
```bash
docker exec flowers-postgres psql -U flowers -d flowers_db -c "\d orders" | grep merchant_order_id
```
Expected: shows `merchant_order_id | text` with unique constraint.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/shared/db/schema/orders.ts backend/src/shared/db/migrations/
git commit -m "feat(backend): add merchant_order_id column to orders table

Used as a unique idempotency key for payment provider callbacks.
Migration 0001 adds the nullable text column with a UNIQUE constraint."
```

---

## Task 2: Create `orders.errors.ts`

**Files:**
- Create: `src/modules/orders/orders.errors.ts`

- [ ] **Step 1: Create the error classes**

Create `src/modules/orders/orders.errors.ts`:
```ts
import { AppError } from '../../shared/middleware/error.middleware';

export class CartNotFoundError extends AppError {
  constructor() {
    super(404, 'CART_NOT_FOUND', 'Cart not found');
  }
}

export class CartExpiredError extends AppError {
  constructor() {
    super(404, 'CART_EXPIRED', 'Cart has expired');
  }
}

export class EmptyCartError extends AppError {
  constructor() {
    super(400, 'EMPTY_CART', 'Cannot create order from empty cart');
  }
}

export class ItemAlreadyInCartError extends AppError {
  constructor() {
    super(409, 'ITEM_ALREADY_IN_CART', 'This listing is already in your cart');
  }
}

export class CartItemNotFoundError extends AppError {
  constructor() {
    super(404, 'CART_ITEM_NOT_FOUND', 'Cart item not found');
  }
}

export class ListingUnavailableError extends AppError {
  constructor(listingId: string) {
    super(409, 'LISTING_UNAVAILABLE', 'Listing is no longer available', {
      listingId,
    });
  }
}

export class InsufficientStockError extends AppError {
  constructor(listingId: string, available: number, requested: number) {
    super(409, 'INSUFFICIENT_STOCK', 'Insufficient stock for listing', {
      listingId,
      available,
      requested,
    });
  }
}

export class OrderNotFoundError extends AppError {
  constructor() {
    super(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
}

export class PaymentCreationFailedError extends AppError {
  constructor() {
    super(502, 'PAYMENT_CREATION_FAILED', 'Failed to initiate payment');
  }
}

export class InvalidOrderTransitionError extends AppError {
  constructor(from: string, to: string) {
    super(409, 'INVALID_ORDER_TRANSITION', 'Invalid order status transition', {
      from,
      to,
    });
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/modules/orders/orders.errors.ts
git commit -m "feat(backend/orders): 10 typed errors for cart + order flow"
```

---

## Task 3: State machine + 5 tests

**Files:**
- Create: `src/modules/orders/orders.state-machine.ts`
- Create: `src/modules/orders/__tests__/orders.state-machine.test.ts`

- [ ] **Step 1: Create the state machine**

Create `src/modules/orders/orders.state-machine.ts`:
```ts
/**
 * Order state machine.
 *
 * Allowed transitions:
 *   pending → paid       (webhook on payment success)
 *   pending → cancelled  (webhook on payment failure, or buyer cancel)
 *   paid → shipped       (admin action)
 *   paid → cancelled     (admin refund)
 *   shipped → delivered  (admin action)
 *
 * Terminal states: delivered, cancelled (no outgoing transitions).
 */
export const TRANSITIONS: Record<string, string[]> = {
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

- [ ] **Step 2: Create test file with 5 tests**

Create `src/modules/orders/__tests__/orders.state-machine.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { canTransition, TRANSITIONS } from '../orders.state-machine';

describe('orders state machine', () => {
  describe('canTransition', () => {
    it('allows pending → paid', () => {
      expect(canTransition('pending', 'paid')).toBe(true);
    });

    it('allows pending → cancelled', () => {
      expect(canTransition('pending', 'cancelled')).toBe(true);
    });

    it('allows paid → shipped', () => {
      expect(canTransition('paid', 'shipped')).toBe(true);
    });

    it('allows shipped → delivered', () => {
      expect(canTransition('shipped', 'delivered')).toBe(true);
    });

    it('rejects invalid transitions', () => {
      // Cannot go back
      expect(canTransition('paid', 'pending')).toBe(false);
      // Cannot skip states
      expect(canTransition('pending', 'shipped')).toBe(false);
      expect(canTransition('pending', 'delivered')).toBe(false);
      expect(canTransition('paid', 'delivered')).toBe(false);
      // Terminal states cannot transition
      expect(canTransition('delivered', 'paid')).toBe(false);
      expect(canTransition('delivered', 'cancelled')).toBe(false);
      expect(canTransition('cancelled', 'paid')).toBe(false);
      expect(canTransition('cancelled', 'pending')).toBe(false);
      // Unknown state
      expect(canTransition('unknown', 'paid')).toBe(false);
    });
  });

  it('TRANSITIONS map has all 5 order statuses as keys', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([
      'cancelled',
      'delivered',
      'paid',
      'pending',
      'shipped',
    ]);
  });
});
```

Wait — that's 6 tests. Remove the last `it` block, keeping exactly 5 as specified in the spec. The 5 tests are the 4 "allows" + 1 "rejects invalid transitions" (which uses multiple assertions).

Final test file has these 5 `it()` blocks:
1. `allows pending → paid`
2. `allows pending → cancelled`
3. `allows paid → shipped`
4. `allows shipped → delivered`
5. `rejects invalid transitions` (multiple assertions in one test)

- [ ] **Step 3: Run tests**

```bash
pnpm test
```
Expected: 5 new tests pass + 45 existing = 50 total.

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/modules/orders/orders.state-machine.ts backend/src/modules/orders/__tests__/orders.state-machine.test.ts
git commit -m "feat(backend/orders): order state machine with canTransition

5 allowed transitions: pending→{paid,cancelled}, paid→{shipped,cancelled},
shipped→delivered. Terminal states: delivered, cancelled. Includes
5 unit tests covering all valid and invalid transitions."
```

---

## Task 4: Create `orders.schema.ts`

**Files:**
- Create: `src/modules/orders/orders.schema.ts`

- [ ] **Step 1: Create the schema file**

Create `src/modules/orders/orders.schema.ts`:
```ts
import { z } from 'zod';
import { currencySchema } from '../catalog/catalog.schema';

// Cart request schemas
export const addCartItemBodySchema = z.object({
  listingId: z.string().uuid(),
  quantityBoxes: z.coerce.number().int().positive(),
});

export const updateCartItemBodySchema = z.object({
  quantityBoxes: z.coerce.number().int().positive(),
});

export const cartItemParamsSchema = z.object({
  id: z.string().uuid(),
});

export const cartQuerySchema = z.object({
  currency: currencySchema,
});

// Order request schemas
export const shippingAddressSchema = z.object({
  address: z.string().min(10).max(500),
  contactName: z.string().min(2).max(200),
  contactPhone: z.string().min(5).max(50),
});

export const createOrderBodySchema = z.object({
  shippingAddress: shippingAddressSchema,
  notes: z.string().max(1000).optional(),
  displayCurrency: currencySchema.optional(),
});

export const orderIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const ordersListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// Cart response shapes
const listingRefSchema = z.object({
  id: z.string().uuid(),
  product: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    species: z.string(),
    color: z.string(),
    imageUrl: z.string(),
  }),
  seller: z.object({
    id: z.string().uuid(),
    name: z.string(),
    country: z.string(),
    verified: z.boolean(),
  }),
  sellerPrice: z.string(),
  amsPrice: z.string(),
  boxQuantity: z.number().int(),
  availableStock: z.number().int(),
  deliveryDate: z.string(),
});

export const cartItemResponseSchema = z.object({
  id: z.string().uuid(),
  listingId: z.string().uuid(),
  quantityBoxes: z.number().int(),
  createdAt: z.string(),
});

export const cartResponseSchema = z.object({
  id: z.string().uuid(),
  expiresAt: z.string(),
  items: z.array(
    z.object({
      id: z.string().uuid(),
      listing: listingRefSchema,
      quantityBoxes: z.number().int(),
      lineTotal: z.string(),
    }),
  ),
  subtotal: z.string(),
  commission: z.string(),
  total: z.string(),
});

// Order response shapes
const orderItemResponseSchema = z.object({
  id: z.string().uuid(),
  listingId: z.string().uuid(),
  sellerId: z.string().uuid(),
  quantityBoxes: z.number().int(),
  unitPriceUsd: z.string(),
  totalPriceUsd: z.string(),
  deliveryDate: z.string(),
});

export const orderDetailSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'paid', 'shipped', 'delivered', 'cancelled']),
  subtotalUsd: z.string(),
  commissionUsd: z.string(),
  totalUsd: z.string(),
  displayCurrency: z.enum(['USD', 'EUR', 'RUB']),
  shippingAddress: shippingAddressSchema,
  notes: z.string().nullable(),
  items: z.array(orderItemResponseSchema),
  createdAt: z.string(),
});

export const orderSummarySchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'paid', 'shipped', 'delivered', 'cancelled']),
  totalUsd: z.string(),
  displayCurrency: z.enum(['USD', 'EUR', 'RUB']),
  createdAt: z.string(),
});

export const ordersListResponseSchema = z.object({
  data: z.array(orderSummarySchema),
  meta: z.object({
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    pages: z.number().int(),
  }),
});

export const createOrderResponseSchema = z.object({
  order: orderDetailSchema,
  paymentUrl: z.string(),
});

// Inferred types
export type AddCartItemBody = z.infer<typeof addCartItemBodySchema>;
export type UpdateCartItemBody = z.infer<typeof updateCartItemBodySchema>;
export type CreateOrderBody = z.infer<typeof createOrderBodySchema>;
export type ShippingAddress = z.infer<typeof shippingAddressSchema>;
export type CartItemResponse = z.infer<typeof cartItemResponseSchema>;
export type CartResponse = z.infer<typeof cartResponseSchema>;
export type OrderDetail = z.infer<typeof orderDetailSchema>;
export type OrderSummary = z.infer<typeof orderSummarySchema>;
export type CreateOrderResponse = z.infer<typeof createOrderResponseSchema>;
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/modules/orders/orders.schema.ts
git commit -m "feat(backend/orders): Zod schemas for cart and order endpoints"
```

---

## Task 5: Payment provider interface + MockPaymentProvider + 3 tests

**Files:**
- Create: `src/modules/payments/payment-provider.ts`
- Create: `src/modules/payments/mock-payment-provider.ts`
- Create: `src/modules/payments/__tests__/mock-payment-provider.test.ts`

- [ ] **Step 1: Create the interface**

Create `src/modules/payments/payment-provider.ts`:
```ts
export type CreatePaymentParams = {
  merchantOrderId: string;
  amountUsd: string;
  description: string;
  buyerEmail?: string;
  callbackUrl: string;
  successUrl: string;
  failUrl: string;
};

export type CreatePaymentResult = {
  externalId: string;
  paymentUrl: string;
};

export type WebhookPayload = {
  merchantOrderId: string;
  externalId: string;
  status: 'paid' | 'failed';
};

export interface PaymentProvider {
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>;
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
  parseWebhookPayload(body: unknown): WebhookPayload;
}
```

- [ ] **Step 2: Create MockPaymentProvider**

Create `src/modules/payments/mock-payment-provider.ts`:
```ts
import { randomUUID } from 'node:crypto';
import type {
  CreatePaymentParams,
  CreatePaymentResult,
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
```

- [ ] **Step 3: Create the 3 tests**

Create `src/modules/payments/__tests__/mock-payment-provider.test.ts`:
```ts
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
```

- [ ] **Step 4: Run tests**

```bash
pnpm test
```
Expected: 53 total (50 + 3 new).

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/modules/payments/payment-provider.ts backend/src/modules/payments/mock-payment-provider.ts backend/src/modules/payments/__tests__/mock-payment-provider.test.ts
git commit -m "feat(backend/payments): PaymentProvider interface + MockPaymentProvider

Provider-agnostic interface (createPayment, verifyWebhookSignature,
parseWebhookPayload) with a zero-dependency mock implementation.
3 unit tests. Future ArcoPayPaymentProvider will implement the same
interface and replace MockPaymentProvider in app.ts."
```

---

## Task 6: OrdersService scaffold + test harness

**Files:**
- Create: `src/modules/orders/orders.service.ts`
- Create: `src/modules/orders/__tests__/orders.service.test.ts`

- [ ] **Step 1: Create the service skeleton**

Create `src/modules/orders/orders.service.ts`:
```ts
import type { Database } from '../../shared/db/client';
import type { FxService } from '../../shared/currency/fx.service';
import type { PaymentProvider } from '../payments/payment-provider';
import type {
  AddCartItemBody,
  UpdateCartItemBody,
  CreateOrderBody,
  CartItemResponse,
  CartResponse,
  OrderDetail,
  OrderSummary,
  CreateOrderResponse,
} from './orders.schema';

export type OrdersServiceConfig = {
  commissionPercent: number;
  cartTtlHours: number;
  callbackUrl: string;
  successUrl: string;
  failUrl: string;
};

export class OrdersService {
  constructor(
    private readonly db: Database,
    private readonly fxService: FxService,
    private readonly paymentProvider: PaymentProvider,
    private readonly config: OrdersServiceConfig,
  ) {}

  async addCartItem(
    _userId: string,
    _input: AddCartItemBody,
  ): Promise<CartItemResponse> {
    void this.db;
    void this.fxService;
    void this.paymentProvider;
    void this.config;
    throw new Error('not implemented');
  }

  async getCart(_userId: string, _currency: string): Promise<CartResponse> {
    throw new Error('not implemented');
  }

  async updateCartItem(
    _userId: string,
    _itemId: string,
    _input: UpdateCartItemBody,
  ): Promise<CartItemResponse> {
    throw new Error('not implemented');
  }

  async removeCartItem(_userId: string, _itemId: string): Promise<void> {
    throw new Error('not implemented');
  }

  async createOrder(
    _userId: string,
    _input: CreateOrderBody,
  ): Promise<CreateOrderResponse> {
    throw new Error('not implemented');
  }

  async listOrders(
    _userId: string,
    _page: number,
    _limit: number,
  ): Promise<{ data: OrderSummary[]; meta: { total: number; page: number; limit: number; pages: number } }> {
    throw new Error('not implemented');
  }

  async getOrderById(_userId: string, _orderId: string): Promise<OrderDetail> {
    throw new Error('not implemented');
  }
}
```

Note the `void this.X` fence in `addCartItem` — same TS6138 workaround used in auth Task 6. Subsequent tasks replace method bodies and remove the fence.

- [ ] **Step 2: Create test file with mocks and shared fixtures**

Create `src/modules/orders/__tests__/orders.service.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { OrdersService, type OrdersServiceConfig } from '../orders.service';
import type { Database } from '../../../shared/db/client';
import type { FxService } from '../../../shared/currency/fx.service';
import type { PaymentProvider } from '../../payments/payment-provider';

function createDbMock() {
  const db = {
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    offset: vi.fn().mockReturnThis(),
    for: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };
  return db as unknown as Database & typeof db;
}

function createFxMock() {
  return {
    getRate: vi.fn().mockResolvedValue(1),
    convert: vi.fn().mockImplementation((amount: string) => Promise.resolve(amount)),
  } as unknown as FxService & {
    getRate: ReturnType<typeof vi.fn>;
    convert: ReturnType<typeof vi.fn>;
  };
}

function createPaymentProviderMock() {
  return {
    createPayment: vi.fn().mockResolvedValue({
      externalId: 'mock-ext-id',
      paymentUrl: 'https://mock-pay.example.com/FL-20260410-TEST0001',
    }),
    verifyWebhookSignature: vi.fn().mockReturnValue(true),
    parseWebhookPayload: vi.fn(),
  } as unknown as PaymentProvider & {
    createPayment: ReturnType<typeof vi.fn>;
    verifyWebhookSignature: ReturnType<typeof vi.fn>;
    parseWebhookPayload: ReturnType<typeof vi.fn>;
  };
}

const testConfig: OrdersServiceConfig = {
  commissionPercent: 12,
  cartTtlHours: 24,
  callbackUrl: 'http://localhost:3000/api/v1/payments/callback',
  successUrl: 'http://localhost:5173/orders/{orderId}/success',
  failUrl: 'http://localhost:5173/orders/{orderId}/fail',
};

const userId = '00000000-0000-0000-0000-000000000001';

describe('OrdersService', () => {
  let db: ReturnType<typeof createDbMock>;
  let fx: ReturnType<typeof createFxMock>;
  let paymentProvider: ReturnType<typeof createPaymentProviderMock>;
  let service: OrdersService;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createDbMock();
    fx = createFxMock();
    paymentProvider = createPaymentProviderMock();
    service = new OrdersService(db, fx, paymentProvider, testConfig);
  });

  it('instantiates', () => {
    expect(service).toBeInstanceOf(OrdersService);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm test
```
Expected: 54 total (53 + 1 instantiation smoke test).

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/modules/orders/orders.service.ts backend/src/modules/orders/__tests__/orders.service.test.ts
git commit -m "feat(backend/orders): OrdersService skeleton + test harness

Class with 7 method stubs, injection of db/fxService/paymentProvider/config,
TS6138 workaround on first stub, test file with mock factories for all
dependencies including chainable db with transaction support."
```

---

## Task 7: `addCartItem` — TDD (3 tests)

**Files:**
- Modify: `src/modules/orders/orders.service.ts`
- Modify: `src/modules/orders/__tests__/orders.service.test.ts`

- [ ] **Step 1: Add the first test — happy path creates cart + item**

Add inside `describe('OrdersService', () => { ... })`:
```ts
  describe('addCartItem', () => {
    const listingId = '00000000-0000-0000-0000-000000000010';

    const activeListing = {
      id: listingId,
      isActive: true,
    };

    const cartRow = {
      id: '00000000-0000-0000-0000-000000000100',
      userId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdAt: new Date(),
    };

    const cartItemRow = {
      id: '00000000-0000-0000-0000-000000001000',
      cartId: cartRow.id,
      listingId,
      quantityBoxes: 3,
      createdAt: new Date(),
    };

    it('creates cart and item on first add', async () => {
      // Listing lookup: active
      db.limit.mockResolvedValueOnce([activeListing]);
      // Existing cart lookup: none
      db.limit.mockResolvedValueOnce([]);
      // Insert cart: returns new cart
      db.returning.mockResolvedValueOnce([cartRow]);
      // Duplicate cart item check: none
      db.limit.mockResolvedValueOnce([]);
      // Insert cart item: returns the new item
      db.returning.mockResolvedValueOnce([cartItemRow]);

      const result = await service.addCartItem(userId, {
        listingId,
        quantityBoxes: 3,
      });

      expect(result.id).toBe(cartItemRow.id);
      expect(result.listingId).toBe(listingId);
      expect(result.quantityBoxes).toBe(3);
    });
  });
```

- [ ] **Step 2: Run — should fail with "not implemented"**

```bash
pnpm test
```
Expected: the new test fails, others pass.

- [ ] **Step 3: Implement `addCartItem`**

In `src/modules/orders/orders.service.ts`, add imports at the top:
```ts
import { and, eq } from 'drizzle-orm';
import { listings } from '../../shared/db/schema/listings';
import { carts, cartItems } from '../../shared/db/schema/carts';
import {
  CartExpiredError,
  ItemAlreadyInCartError,
  ListingUnavailableError,
} from './orders.errors';
```

Replace the `addCartItem` method body (removing the `void this.X` fence):
```ts
  async addCartItem(
    userId: string,
    input: AddCartItemBody,
  ): Promise<CartItemResponse> {
    // 1. Verify listing exists and is active
    const listingRows = await this.db
      .select({ id: listings.id, isActive: listings.isActive })
      .from(listings)
      .where(eq(listings.id, input.listingId))
      .limit(1);

    const listing = listingRows[0];
    if (!listing || !listing.isActive) {
      throw new ListingUnavailableError(input.listingId);
    }

    // 2. Get or create cart (handle expiry)
    const cart = await this.getOrCreateCart(userId);

    // 3. Check for duplicate
    const existingRows = await this.db
      .select({ id: cartItems.id })
      .from(cartItems)
      .where(
        and(
          eq(cartItems.cartId, cart.id),
          eq(cartItems.listingId, input.listingId),
        ),
      )
      .limit(1);

    if (existingRows.length > 0) {
      throw new ItemAlreadyInCartError();
    }

    // 4. Insert
    const inserted = await this.db
      .insert(cartItems)
      .values({
        cartId: cart.id,
        listingId: input.listingId,
        quantityBoxes: input.quantityBoxes,
      })
      .returning();

    const row = inserted[0]!;
    return {
      id: row.id,
      listingId: row.listingId,
      quantityBoxes: row.quantityBoxes,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async getOrCreateCart(userId: string): Promise<typeof carts.$inferSelect> {
    // Try to find an existing cart
    const existing = await this.db
      .select()
      .from(carts)
      .where(eq(carts.userId, userId))
      .limit(1);

    const found = existing[0];
    if (found) {
      if (found.expiresAt.getTime() <= Date.now()) {
        // Expired — delete and create new
        await this.db.delete(carts).where(eq(carts.id, found.id));
      } else {
        return found;
      }
    }

    const expiresAt = new Date(Date.now() + this.config.cartTtlHours * 60 * 60 * 1000);
    const inserted = await this.db
      .insert(carts)
      .values({ userId, expiresAt })
      .returning();
    return inserted[0]!;
  }
```

Also remove the `void this.X` fence from the previous skeleton — the real implementation now uses `this.db` and `this.config`.

- [ ] **Step 4: Run — should pass**

```bash
pnpm test
```
Expected: the new test passes.

- [ ] **Step 5: Add test — listing not found / inactive**

```ts
    it('throws ListingUnavailableError when listing is inactive', async () => {
      db.limit.mockResolvedValueOnce([{ id: listingId, isActive: false }]);

      await expect(
        service.addCartItem(userId, { listingId, quantityBoxes: 1 }),
      ).rejects.toThrow('Listing is no longer available');
    });
```

Run `pnpm test` — should pass.

- [ ] **Step 6: Add test — duplicate listing in cart**

```ts
    it('throws ItemAlreadyInCartError when listing already in cart', async () => {
      db.limit.mockResolvedValueOnce([activeListing]);
      db.limit.mockResolvedValueOnce([cartRow]); // existing active cart
      db.limit.mockResolvedValueOnce([{ id: 'existing-cart-item-id' }]); // duplicate exists

      await expect(
        service.addCartItem(userId, { listingId, quantityBoxes: 1 }),
      ).rejects.toThrow('This listing is already in your cart');
    });
```

Run `pnpm test`:
Expected: 57 total (54 + 3).

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm typecheck
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/modules/orders/orders.service.ts backend/src/modules/orders/__tests__/orders.service.test.ts
git commit -m "feat(backend/orders): addCartItem() — 3 TDD tests

Happy path creates cart on first add, listing inactive throws
ListingUnavailableError, duplicate listing throws ItemAlreadyInCartError."
```

---

## Task 8: `getCart` — TDD (4 tests)

**Files:**
- Modify: `src/modules/orders/orders.service.ts`
- Modify: `src/modules/orders/__tests__/orders.service.test.ts`

- [ ] **Step 1: Add happy path test**

Add inside `describe('OrdersService', () => { ... })`:
```ts
  describe('getCart', () => {
    const cartId = '00000000-0000-0000-0000-000000000100';
    const listingId = '00000000-0000-0000-0000-000000000010';

    const validCart = {
      id: cartId,
      userId,
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      createdAt: new Date(),
    };

    const joinedItemRow = {
      cartItemId: '00000000-0000-0000-0000-000000001000',
      quantityBoxes: 2,
      listingId,
      sellerPriceUsd: '12.50',
      amsPriceUsd: '14.00',
      boxQuantity: 25,
      availableStock: 100,
      deliveryDate: '2026-04-20',
      productId: '00000000-0000-0000-0000-000000000200',
      productName: 'Pink Mondial',
      productSlug: 'pink-mondial',
      productSpecies: 'Rose',
      productColor: 'Pink',
      productImageUrl: 'https://example.com/pink.jpg',
      sellerId: '00000000-0000-0000-0000-000000000300',
      sellerName: 'Flores de Colombia',
      sellerCountry: 'CO',
      sellerVerified: true,
    };

    it('returns cart with items, subtotal, commission, total', async () => {
      db.limit.mockResolvedValueOnce([validCart]); // cart lookup
      db.where.mockResolvedValueOnce([joinedItemRow]); // items with join (terminal: where)

      const result = await service.getCart(userId, 'USD');

      expect(result.id).toBe(cartId);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.quantityBoxes).toBe(2);
      expect(result.items[0]!.lineTotal).toBe('25.00'); // 12.50 × 2
      expect(result.subtotal).toBe('25.00');
      expect(result.commission).toBe('3.00'); // 25 × 0.12
      expect(result.total).toBe('28.00');
    });
  });
```

**Note on mock chaining:** For queries that terminate on `where` (like when we use query builder without limit/orderBy), the mock factory has `where: vi.fn().mockReturnThis()`. For the query that IS the terminal, we override: `db.where.mockResolvedValueOnce([...])` — this makes `where` return a promise for that one call. This is a limitation of the chainable mock pattern; the service code should be structured so the terminal is predictable.

Alternative: if the service code always ends chains with `.limit()` or similar, override that terminal instead. For `getCart`, the items query uses joins and ends with `.where(...)` as the terminal (no limit because we want all items). Make sure your implementation matches this assumption, OR adjust the mock override to target whatever terminal method the real implementation uses.

- [ ] **Step 2: Run — should fail**

```bash
pnpm test
```

- [ ] **Step 3: Implement `getCart`**

In `src/modules/orders/orders.service.ts`, import needed symbols:
```ts
import { sql } from 'drizzle-orm';
import { products } from '../../shared/db/schema/products';
import { sellers } from '../../shared/db/schema/sellers';
import { CartNotFoundError } from './orders.errors';
```

Replace `getCart` method body:
```ts
  async getCart(userId: string, currency: string): Promise<CartResponse> {
    // 1. Load cart, check expiry
    const cartRows = await this.db
      .select()
      .from(carts)
      .where(eq(carts.userId, userId))
      .limit(1);

    const cart = cartRows[0];
    if (!cart) throw new CartNotFoundError();
    if (cart.expiresAt.getTime() <= Date.now()) {
      throw new CartExpiredError();
    }

    // 2. Load items with listing + product + seller info
    const itemRows = await this.db
      .select({
        cartItemId: cartItems.id,
        quantityBoxes: cartItems.quantityBoxes,
        listingId: listings.id,
        sellerPriceUsd: listings.sellerPriceUsd,
        amsPriceUsd: listings.amsPriceUsd,
        boxQuantity: listings.boxQuantity,
        availableStock: listings.availableStock,
        deliveryDate: listings.deliveryDate,
        productId: products.id,
        productName: products.name,
        productSlug: products.slug,
        productSpecies: products.species,
        productColor: products.color,
        productImageUrl: products.imageUrl,
        sellerId: sellers.id,
        sellerName: sellers.name,
        sellerCountry: sellers.country,
        sellerVerified: sellers.verified,
      })
      .from(cartItems)
      .innerJoin(listings, eq(cartItems.listingId, listings.id))
      .innerJoin(products, eq(listings.productId, products.id))
      .innerJoin(sellers, eq(listings.sellerId, sellers.id))
      .where(eq(cartItems.cartId, cart.id));

    // 3. Convert prices, compute line totals, subtotal, commission
    let subtotalUsd = 0;
    const items = await Promise.all(
      itemRows.map(async (row) => {
        const lineTotalUsd = parseFloat(row.sellerPriceUsd) * row.quantityBoxes;
        subtotalUsd += lineTotalUsd;

        const sellerPrice = await this.fxService.convert(
          row.sellerPriceUsd,
          currency,
        );
        const amsPrice = await this.fxService.convert(row.amsPriceUsd, currency);
        const lineTotal = await this.fxService.convert(
          lineTotalUsd.toFixed(2),
          currency,
        );

        return {
          id: row.cartItemId,
          listing: {
            id: row.listingId,
            product: {
              id: row.productId,
              name: row.productName,
              slug: row.productSlug,
              species: row.productSpecies,
              color: row.productColor,
              imageUrl: row.productImageUrl,
            },
            seller: {
              id: row.sellerId,
              name: row.sellerName,
              country: row.sellerCountry,
              verified: row.sellerVerified,
            },
            sellerPrice,
            amsPrice,
            boxQuantity: row.boxQuantity,
            availableStock: row.availableStock,
            deliveryDate: row.deliveryDate,
          },
          quantityBoxes: row.quantityBoxes,
          lineTotal,
        };
      }),
    );

    const commissionUsd = (subtotalUsd * this.config.commissionPercent) / 100;
    const totalUsd = subtotalUsd + commissionUsd;

    return {
      id: cart.id,
      expiresAt: cart.expiresAt.toISOString(),
      items,
      subtotal: await this.fxService.convert(subtotalUsd.toFixed(2), currency),
      commission: await this.fxService.convert(commissionUsd.toFixed(2), currency),
      total: await this.fxService.convert(totalUsd.toFixed(2), currency),
    };
  }
```

- [ ] **Step 4: Run — should pass**

- [ ] **Step 5: Add test — no cart**

```ts
    it('throws CartNotFoundError when user has no cart', async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(service.getCart(userId, 'USD')).rejects.toThrow(
        'Cart not found',
      );
    });
```

- [ ] **Step 6: Add test — expired cart**

```ts
    it('throws CartExpiredError when cart is expired', async () => {
      const expiredCart = {
        ...validCart,
        expiresAt: new Date(Date.now() - 1000),
      };
      db.limit.mockResolvedValueOnce([expiredCart]);

      await expect(service.getCart(userId, 'USD')).rejects.toThrow(
        'Cart has expired',
      );
    });
```

- [ ] **Step 7: Add test — commission rounding**

```ts
    it('rounds commission to 2 decimal places', async () => {
      db.limit.mockResolvedValueOnce([validCart]);
      // Item with price that produces fractional commission
      db.where.mockResolvedValueOnce([
        { ...joinedItemRow, sellerPriceUsd: '10.33', quantityBoxes: 3 },
      ]);

      const result = await service.getCart(userId, 'USD');

      // 10.33 × 3 = 30.99; commission = 30.99 × 0.12 = 3.7188 → "3.72"
      expect(result.subtotal).toBe('30.99');
      expect(result.commission).toBe('3.72');
      expect(result.total).toBe('34.71');
    });
```

- [ ] **Step 8: Run all tests**

```bash
pnpm test
```
Expected: 61 total (57 + 4).

- [ ] **Step 9: Commit**

```bash
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/modules/orders/orders.service.ts backend/src/modules/orders/__tests__/orders.service.test.ts
git commit -m "feat(backend/orders): getCart() — 4 TDD tests

Live cart with FX-converted prices, line totals, subtotal, commission,
and grand total. Handles not-found and expired cart states. Commission
is rounded to 2 decimal places per business rule."
```

---

## Task 9: `updateCartItem` + `removeCartItem` — TDD (3 tests)

**Files:**
- Modify: `src/modules/orders/orders.service.ts`
- Modify: `src/modules/orders/__tests__/orders.service.test.ts`

- [ ] **Step 1: Add `updateCartItem` happy path test**

```ts
  describe('updateCartItem', () => {
    const cartItemId = '00000000-0000-0000-0000-000000001000';

    it('updates quantity for owned cart item', async () => {
      db.limit.mockResolvedValueOnce([
        { id: cartItemId, userId, quantityBoxes: 3 }, // ownership lookup passes
      ]);
      db.returning.mockResolvedValueOnce([
        {
          id: cartItemId,
          cartId: '00000000-0000-0000-0000-000000000100',
          listingId: '00000000-0000-0000-0000-000000000010',
          quantityBoxes: 5,
          createdAt: new Date(),
        },
      ]);

      const result = await service.updateCartItem(userId, cartItemId, {
        quantityBoxes: 5,
      });

      expect(result.quantityBoxes).toBe(5);
    });

    it('throws CartItemNotFoundError when item does not belong to user', async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(
        service.updateCartItem(userId, cartItemId, { quantityBoxes: 5 }),
      ).rejects.toThrow('Cart item not found');
    });
  });

  describe('removeCartItem', () => {
    const cartItemId = '00000000-0000-0000-0000-000000001000';

    it('removes cart item owned by user', async () => {
      db.limit.mockResolvedValueOnce([{ id: cartItemId }]);
      db.where.mockResolvedValueOnce([]);

      await expect(
        service.removeCartItem(userId, cartItemId),
      ).resolves.toBeUndefined();

      expect(db.delete).toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run — should fail**

- [ ] **Step 3: Implement `updateCartItem` and `removeCartItem`**

Add import if not present:
```ts
import { CartItemNotFoundError } from './orders.errors';
```

Replace `updateCartItem`:
```ts
  async updateCartItem(
    userId: string,
    itemId: string,
    input: UpdateCartItemBody,
  ): Promise<CartItemResponse> {
    // Ownership check via join with carts
    const ownership = await this.db
      .select({ id: cartItems.id })
      .from(cartItems)
      .innerJoin(carts, eq(cartItems.cartId, carts.id))
      .where(and(eq(cartItems.id, itemId), eq(carts.userId, userId)))
      .limit(1);

    if (ownership.length === 0) {
      throw new CartItemNotFoundError();
    }

    const updated = await this.db
      .update(cartItems)
      .set({ quantityBoxes: input.quantityBoxes })
      .where(eq(cartItems.id, itemId))
      .returning();

    const row = updated[0]!;
    return {
      id: row.id,
      listingId: row.listingId,
      quantityBoxes: row.quantityBoxes,
      createdAt: row.createdAt.toISOString(),
    };
  }
```

Replace `removeCartItem`:
```ts
  async removeCartItem(userId: string, itemId: string): Promise<void> {
    const ownership = await this.db
      .select({ id: cartItems.id })
      .from(cartItems)
      .innerJoin(carts, eq(cartItems.cartId, carts.id))
      .where(and(eq(cartItems.id, itemId), eq(carts.userId, userId)))
      .limit(1);

    if (ownership.length === 0) {
      throw new CartItemNotFoundError();
    }

    await this.db.delete(cartItems).where(eq(cartItems.id, itemId));
  }
```

- [ ] **Step 4: Run — should pass**

```bash
pnpm test
```
Expected: 64 total (61 + 3).

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/modules/orders/orders.service.ts backend/src/modules/orders/__tests__/orders.service.test.ts
git commit -m "feat(backend/orders): updateCartItem + removeCartItem — 3 TDD tests

Ownership check via JOIN with carts table; 404 CART_ITEM_NOT_FOUND
for items that don't exist or belong to a different user."
```

---

## Task 10: `createOrder` — TDD (7 tests)

**Files:**
- Modify: `src/modules/orders/orders.service.ts`
- Modify: `src/modules/orders/__tests__/orders.service.test.ts`

This is the biggest method. 7 tests, ~200 lines of implementation.

- [ ] **Step 1: Add shared fixtures at the top of `describe('OrdersService')`**

Inside the main describe block, at the top, add:
```ts
  const createOrderInput = {
    shippingAddress: {
      address: '123 Flower Ave, Miami, FL 33101',
      contactName: 'John Smith',
      contactPhone: '+1-305-555-0100',
    },
    notes: 'Leave at reception',
    displayCurrency: 'USD' as const,
  };
```

- [ ] **Step 2: Add first test — happy path**

```ts
  describe('createOrder', () => {
    const cartId = '00000000-0000-0000-0000-000000000100';
    const listingId = '00000000-0000-0000-0000-000000000010';
    const sellerId = '00000000-0000-0000-0000-000000000020';
    const productId = '00000000-0000-0000-0000-000000000030';
    const orderId = '00000000-0000-0000-0000-000000000040';
    const orderItemId = '00000000-0000-0000-0000-000000000050';
    const paymentRowId = '00000000-0000-0000-0000-000000000060';

    const validCart = {
      id: cartId,
      userId,
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      createdAt: new Date(),
    };

    const cartItemJoined = {
      cartItemId: '00000000-0000-0000-0000-000000001000',
      quantityBoxes: 3,
      listingId,
      sellerId,
      sellerPriceUsd: '12.50',
      amsPriceUsd: '14.00',
      deliveryDate: '2026-04-20',
      isActive: true,
      availableStock: 100,
    };

    const insertedOrder = {
      id: orderId,
      buyerId: userId,
      status: 'pending' as const,
      subtotalUsd: '37.50',
      commissionUsd: '4.50',
      totalUsd: '42.00',
      displayCurrency: 'USD' as const,
      shippingAddress: createOrderInput.shippingAddress,
      notes: createOrderInput.notes,
      merchantOrderId: null,
      createdAt: new Date('2026-04-10T10:00:00Z'),
      updatedAt: new Date('2026-04-10T10:00:00Z'),
    };

    const insertedOrderItem = {
      id: orderItemId,
      orderId,
      listingId,
      sellerId,
      quantityBoxes: 3,
      unitPriceUsd: '12.50',
      totalPriceUsd: '37.50',
      deliveryDate: '2026-04-20',
    };

    it('happy path creates order with snapshots, commission, payment', async () => {
      // Cart lookup (outside transaction)
      db.limit.mockResolvedValueOnce([validCart]);
      // Cart items with listing join (inside transaction, terminal on where)
      db.where.mockResolvedValueOnce([cartItemJoined]);
      // Stock decrement update - returning nothing useful
      db.returning.mockResolvedValueOnce([]);
      // Insert order
      db.returning.mockResolvedValueOnce([insertedOrder]);
      // Insert order_items (batch)
      db.returning.mockResolvedValueOnce([insertedOrderItem]);
      // Delete cart
      db.where.mockResolvedValueOnce([]);
      // Insert payment
      db.returning.mockResolvedValueOnce([{ id: paymentRowId }]);
      // Update order with merchantOrderId
      db.returning.mockResolvedValueOnce([
        { ...insertedOrder, merchantOrderId: 'FL-20260410-TEST0001' },
      ]);

      const result = await service.createOrder(userId, createOrderInput);

      expect(result.order.id).toBe(orderId);
      expect(result.order.status).toBe('pending');
      expect(result.order.subtotalUsd).toBe('37.50');
      expect(result.order.commissionUsd).toBe('4.50');
      expect(result.order.totalUsd).toBe('42.00');
      expect(result.paymentUrl).toBe(
        'https://mock-pay.example.com/FL-20260410-TEST0001',
      );

      // Verify payment provider was called with correct args
      expect(paymentProvider.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          amountUsd: '42.00',
        }),
      );
    });
  });
```

- [ ] **Step 3: Run — should fail**

- [ ] **Step 4: Implement `createOrder`**

Add imports at the top of `orders.service.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { orders, orderItems } from '../../shared/db/schema/orders';
import { payments } from '../../shared/db/schema/payments';
import {
  EmptyCartError,
  InsufficientStockError,
  PaymentCreationFailedError,
} from './orders.errors';
```

Replace `createOrder` method:
```ts
  async createOrder(
    userId: string,
    input: CreateOrderBody,
  ): Promise<CreateOrderResponse> {
    // 1. Load cart, check expiry
    const cartRows = await this.db
      .select()
      .from(carts)
      .where(eq(carts.userId, userId))
      .limit(1);

    const cart = cartRows[0];
    if (!cart) throw new CartNotFoundError();
    if (cart.expiresAt.getTime() <= Date.now()) {
      throw new CartExpiredError();
    }

    // 2. Start transaction — all stock + order inserts atomic
    const { order, items } = await this.db.transaction(async (tx) => {
      // Load cart items with listing data (SELECT FOR UPDATE)
      const itemRows = await tx
        .select({
          cartItemId: cartItems.id,
          quantityBoxes: cartItems.quantityBoxes,
          listingId: listings.id,
          sellerId: listings.sellerId,
          sellerPriceUsd: listings.sellerPriceUsd,
          amsPriceUsd: listings.amsPriceUsd,
          deliveryDate: listings.deliveryDate,
          isActive: listings.isActive,
          availableStock: listings.availableStock,
        })
        .from(cartItems)
        .innerJoin(listings, eq(cartItems.listingId, listings.id))
        .where(eq(cartItems.cartId, cart.id))
        .for('update');

      if (itemRows.length === 0) {
        throw new EmptyCartError();
      }

      // Validate all items
      for (const row of itemRows) {
        if (!row.isActive) {
          throw new ListingUnavailableError(row.listingId);
        }
        if (row.availableStock < row.quantityBoxes) {
          throw new InsufficientStockError(
            row.listingId,
            row.availableStock,
            row.quantityBoxes,
          );
        }
      }

      // Decrement stock for each listing
      for (const row of itemRows) {
        await tx
          .update(listings)
          .set({
            availableStock: row.availableStock - row.quantityBoxes,
          })
          .where(eq(listings.id, row.listingId))
          .returning();
      }

      // Compute totals
      let subtotalUsdNum = 0;
      for (const row of itemRows) {
        subtotalUsdNum += parseFloat(row.sellerPriceUsd) * row.quantityBoxes;
      }
      const commissionUsdNum =
        (subtotalUsdNum * this.config.commissionPercent) / 100;
      const totalUsdNum = subtotalUsdNum + commissionUsdNum;

      const subtotalUsd = subtotalUsdNum.toFixed(2);
      const commissionUsd = commissionUsdNum.toFixed(2);
      const totalUsd = totalUsdNum.toFixed(2);

      // Insert order
      const insertedOrders = await tx
        .insert(orders)
        .values({
          buyerId: userId,
          status: 'pending',
          subtotalUsd,
          commissionUsd,
          totalUsd,
          displayCurrency: input.displayCurrency ?? 'USD',
          shippingAddress: input.shippingAddress,
          notes: input.notes ?? null,
        })
        .returning();

      const order = insertedOrders[0]!;

      // Insert order_items (snapshots)
      const orderItemsToInsert = itemRows.map((row) => {
        const unitPriceUsd = row.sellerPriceUsd;
        const totalPriceUsd = (
          parseFloat(row.sellerPriceUsd) * row.quantityBoxes
        ).toFixed(2);
        return {
          orderId: order.id,
          listingId: row.listingId,
          sellerId: row.sellerId,
          quantityBoxes: row.quantityBoxes,
          unitPriceUsd,
          totalPriceUsd,
          deliveryDate: row.deliveryDate,
        };
      });

      const insertedItems = await tx
        .insert(orderItems)
        .values(orderItemsToInsert)
        .returning();

      return { order, items: insertedItems };
    });

    // 3. Delete cart (outside transaction, non-critical)
    await this.db.delete(carts).where(eq(carts.id, cart.id));

    // 4. Create payment via provider
    const merchantOrderId = generateMerchantOrderId();
    let paymentResult;
    try {
      paymentResult = await this.paymentProvider.createPayment({
        merchantOrderId,
        amountUsd: order.totalUsd,
        description: `Flowers order ${order.id}`,
        callbackUrl: this.config.callbackUrl,
        successUrl: this.config.successUrl.replace('{orderId}', order.id),
        failUrl: this.config.failUrl.replace('{orderId}', order.id),
      });
    } catch (_err) {
      throw new PaymentCreationFailedError();
    }

    // 5. Insert payment row
    await this.db
      .insert(payments)
      .values({
        orderId: order.id,
        provider: 'arcopay',
        externalId: paymentResult.externalId,
        amountUsd: order.totalUsd,
        status: 'pending',
      })
      .returning();

    // 6. Update order with merchantOrderId
    const updatedOrders = await this.db
      .update(orders)
      .set({ merchantOrderId })
      .where(eq(orders.id, order.id))
      .returning();

    const finalOrder = updatedOrders[0] ?? order;

    return {
      order: {
        id: finalOrder.id,
        status: finalOrder.status,
        subtotalUsd: finalOrder.subtotalUsd,
        commissionUsd: finalOrder.commissionUsd,
        totalUsd: finalOrder.totalUsd,
        displayCurrency: finalOrder.displayCurrency,
        shippingAddress: finalOrder.shippingAddress as CreateOrderResponse['order']['shippingAddress'],
        notes: finalOrder.notes,
        items: items.map((item) => ({
          id: item.id,
          listingId: item.listingId,
          sellerId: item.sellerId,
          quantityBoxes: item.quantityBoxes,
          unitPriceUsd: item.unitPriceUsd,
          totalPriceUsd: item.totalPriceUsd,
          deliveryDate: item.deliveryDate,
        })),
        createdAt: finalOrder.createdAt.toISOString(),
      },
      paymentUrl: paymentResult.paymentUrl,
    };
  }
```

Add the `generateMerchantOrderId` helper as a module-level function at the bottom of the file:
```ts
function generateMerchantOrderId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = randomUUID().slice(0, 8).toUpperCase();
  return `FL-${date}-${random}`;
}
```

- [ ] **Step 5: Run — should pass happy path test**

```bash
pnpm test
```

- [ ] **Step 6: Add test — empty cart**

```ts
    it('throws EmptyCartError when cart has no items', async () => {
      db.limit.mockResolvedValueOnce([validCart]);
      db.where.mockResolvedValueOnce([]); // empty items after join (inside tx)

      await expect(
        service.createOrder(userId, createOrderInput),
      ).rejects.toThrow('Cannot create order from empty cart');
    });
```

Wait — the current implementation's `db.where` terminal is used for different things in different places. For empty cart detection, it's the `FOR UPDATE` query that uses `.for('update')` as the terminal. Update the test to use `db.for.mockResolvedValueOnce([])` OR adjust the service to make `.where(...)` the terminal for cart items. The test infrastructure needs to match the implementation chain.

Given the chain `.from(cartItems).innerJoin(...).where(...).for('update')`, the terminal is `.for('update')`. So in tests:
```ts
db.for.mockResolvedValueOnce([]); // or [itemRow] for valid cases
```

Update the happy path test accordingly:
- Remove `db.where.mockResolvedValueOnce([cartItemJoined])`
- Add `db.for.mockResolvedValueOnce([cartItemJoined])`

And for the empty cart test:
```ts
    it('throws EmptyCartError when cart has no items', async () => {
      db.limit.mockResolvedValueOnce([validCart]);
      db.for.mockResolvedValueOnce([]); // empty items via FOR UPDATE query

      await expect(
        service.createOrder(userId, createOrderInput),
      ).rejects.toThrow('Cannot create order from empty cart');
    });
```

- [ ] **Step 7: Add test — expired cart**

```ts
    it('throws CartExpiredError when cart is expired', async () => {
      db.limit.mockResolvedValueOnce([
        { ...validCart, expiresAt: new Date(Date.now() - 1000) },
      ]);

      await expect(
        service.createOrder(userId, createOrderInput),
      ).rejects.toThrow('Cart has expired');
    });
```

- [ ] **Step 8: Add test — listing inactive**

```ts
    it('throws ListingUnavailableError when listing is inactive', async () => {
      db.limit.mockResolvedValueOnce([validCart]);
      db.for.mockResolvedValueOnce([{ ...cartItemJoined, isActive: false }]);

      await expect(
        service.createOrder(userId, createOrderInput),
      ).rejects.toThrow('Listing is no longer available');
    });
```

- [ ] **Step 9: Add test — insufficient stock**

```ts
    it('throws InsufficientStockError when available_stock < requested', async () => {
      db.limit.mockResolvedValueOnce([validCart]);
      db.for.mockResolvedValueOnce([
        { ...cartItemJoined, availableStock: 1, quantityBoxes: 5 },
      ]);

      await expect(
        service.createOrder(userId, createOrderInput),
      ).rejects.toMatchObject({
        code: 'INSUFFICIENT_STOCK',
        details: { listingId, available: 1, requested: 5 },
      });
    });
```

- [ ] **Step 10: Add test — payment provider throws**

```ts
    it('throws PaymentCreationFailedError when provider rejects', async () => {
      db.limit.mockResolvedValueOnce([validCart]);
      db.for.mockResolvedValueOnce([cartItemJoined]);
      db.returning.mockResolvedValueOnce([]); // stock update
      db.returning.mockResolvedValueOnce([insertedOrder]); // order insert
      db.returning.mockResolvedValueOnce([insertedOrderItem]); // order_items
      db.where.mockResolvedValueOnce([]); // cart delete
      paymentProvider.createPayment.mockRejectedValueOnce(
        new Error('Provider down'),
      );

      await expect(
        service.createOrder(userId, createOrderInput),
      ).rejects.toThrow('Failed to initiate payment');
    });
```

- [ ] **Step 11: Add test — price snapshot verification**

```ts
    it('snapshots listing price into order_items (not live-read)', async () => {
      db.limit.mockResolvedValueOnce([validCart]);
      db.for.mockResolvedValueOnce([cartItemJoined]);
      db.returning.mockResolvedValueOnce([]); // stock update
      db.returning.mockResolvedValueOnce([insertedOrder]);
      db.returning.mockResolvedValueOnce([insertedOrderItem]);
      db.where.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([{ id: paymentRowId }]);
      db.returning.mockResolvedValueOnce([
        { ...insertedOrder, merchantOrderId: 'FL-20260410-SNAP001' },
      ]);

      await service.createOrder(userId, createOrderInput);

      // Verify order_items insert was called with the listing price as snapshot
      const insertCalls = vi.mocked(db.insert).mock.calls;
      const valuesCalls = vi.mocked(db.values).mock.calls;
      // Find the call with order_items values
      const orderItemsCall = valuesCalls.find((call) => {
        const value = call[0];
        if (Array.isArray(value)) {
          return value[0]?.unitPriceUsd !== undefined;
        }
        return false;
      });
      expect(orderItemsCall).toBeDefined();
      const values = orderItemsCall![0] as Array<{
        unitPriceUsd: string;
        totalPriceUsd: string;
      }>;
      expect(values[0]!.unitPriceUsd).toBe('12.50'); // snapshot from listing
      expect(values[0]!.totalPriceUsd).toBe('37.50'); // 12.50 × 3
    });
```

- [ ] **Step 12: Run all tests**

```bash
pnpm test
```
Expected: 71 total (64 + 7).

- [ ] **Step 13: Commit**

```bash
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/modules/orders/orders.service.ts backend/src/modules/orders/__tests__/orders.service.test.ts
git commit -m "feat(backend/orders): createOrder() — 7 TDD tests

Transactional stock check with SELECT FOR UPDATE, price snapshots,
commission calculation, cart deletion, payment provider call, and
merchantOrderId update. 7 tests cover happy path, empty cart, expired,
listing inactive, insufficient stock, payment failure, and snapshot
verification."
```

---

## Task 11: `listOrders` + `getOrderById` — TDD (4 tests)

**Files:**
- Modify: `src/modules/orders/orders.service.ts`
- Modify: `src/modules/orders/__tests__/orders.service.test.ts`

- [ ] **Step 1: Add tests**

```ts
  describe('listOrders', () => {
    it('returns paginated orders for user', async () => {
      const orderRow = {
        id: '00000000-0000-0000-0000-000000000040',
        status: 'pending' as const,
        totalUsd: '42.00',
        displayCurrency: 'USD' as const,
        createdAt: new Date('2026-04-10T10:00:00Z'),
      };
      db.offset.mockResolvedValueOnce([orderRow]);
      db.where.mockResolvedValueOnce([{ count: 1 }]);

      const result = await service.listOrders(userId, 1, 20);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.id).toBe(orderRow.id);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        pages: 1,
      });
    });

    it('returns empty list when user has no orders', async () => {
      db.offset.mockResolvedValueOnce([]);
      db.where.mockResolvedValueOnce([{ count: 0 }]);

      const result = await service.listOrders(userId, 1, 20);

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });
  });

  describe('getOrderById', () => {
    const orderId = '00000000-0000-0000-0000-000000000040';

    it('returns order with items for owning user', async () => {
      const orderRow = {
        id: orderId,
        buyerId: userId,
        status: 'pending' as const,
        subtotalUsd: '37.50',
        commissionUsd: '4.50',
        totalUsd: '42.00',
        displayCurrency: 'USD' as const,
        shippingAddress: {
          address: '123 Flower Ave',
          contactName: 'John',
          contactPhone: '+1',
        },
        notes: null,
        merchantOrderId: 'FL-20260410-A1B2C3D4',
        createdAt: new Date('2026-04-10T10:00:00Z'),
        updatedAt: new Date('2026-04-10T10:00:00Z'),
      };
      const itemRow = {
        id: '00000000-0000-0000-0000-000000000050',
        orderId,
        listingId: '00000000-0000-0000-0000-000000000010',
        sellerId: '00000000-0000-0000-0000-000000000020',
        quantityBoxes: 3,
        unitPriceUsd: '12.50',
        totalPriceUsd: '37.50',
        deliveryDate: '2026-04-20',
      };
      db.limit.mockResolvedValueOnce([orderRow]);
      db.where.mockResolvedValueOnce([itemRow]);

      const result = await service.getOrderById(userId, orderId);

      expect(result.id).toBe(orderId);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.unitPriceUsd).toBe('12.50');
    });

    it('throws OrderNotFoundError for order of another user', async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(service.getOrderById(userId, orderId)).rejects.toThrow(
        'Order not found',
      );
    });
  });
```

- [ ] **Step 2: Run — should fail**

- [ ] **Step 3: Implement `listOrders` and `getOrderById`**

Add imports (if not already):
```ts
import { desc } from 'drizzle-orm';
import { OrderNotFoundError } from './orders.errors';
```

Replace `listOrders`:
```ts
  async listOrders(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{ data: OrderSummary[]; meta: { total: number; page: number; limit: number; pages: number } }> {
    const rows = await this.db
      .select({
        id: orders.id,
        status: orders.status,
        totalUsd: orders.totalUsd,
        displayCurrency: orders.displayCurrency,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(eq(orders.buyerId, userId))
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.buyerId, userId));

    const total = countRows[0]?.count ?? 0;

    return {
      data: rows.map((r) => ({
        id: r.id,
        status: r.status,
        totalUsd: r.totalUsd,
        displayCurrency: r.displayCurrency,
        createdAt: r.createdAt.toISOString(),
      })),
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }
```

Replace `getOrderById`:
```ts
  async getOrderById(userId: string, orderId: string): Promise<OrderDetail> {
    const orderRows = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.buyerId, userId)))
      .limit(1);

    const order = orderRows[0];
    if (!order) throw new OrderNotFoundError();

    const itemRows = await this.db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));

    return {
      id: order.id,
      status: order.status,
      subtotalUsd: order.subtotalUsd,
      commissionUsd: order.commissionUsd,
      totalUsd: order.totalUsd,
      displayCurrency: order.displayCurrency,
      shippingAddress: order.shippingAddress as OrderDetail['shippingAddress'],
      notes: order.notes,
      items: itemRows.map((item) => ({
        id: item.id,
        listingId: item.listingId,
        sellerId: item.sellerId,
        quantityBoxes: item.quantityBoxes,
        unitPriceUsd: item.unitPriceUsd,
        totalPriceUsd: item.totalPriceUsd,
        deliveryDate: item.deliveryDate,
      })),
      createdAt: order.createdAt.toISOString(),
    };
  }
```

- [ ] **Step 4: Run all tests**

```bash
pnpm test
```
Expected: 75 total (71 + 4). OrdersService is now fully implemented.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/modules/orders/orders.service.ts backend/src/modules/orders/__tests__/orders.service.test.ts
git commit -m "feat(backend/orders): listOrders + getOrderById — 4 TDD tests

Completes OrdersService. Paginated order history (summary shape),
detailed view with nested order_items, and 404 for orders that don't
belong to the requesting user."
```

---

## Task 12: `WebhookService` + 6 tests

**Files:**
- Create: `src/modules/payments/payments.service.ts`
- Create: `src/modules/payments/__tests__/payments.service.test.ts`

- [ ] **Step 1: Create `WebhookService`**

Create `src/modules/payments/payments.service.ts`:
```ts
import { eq } from 'drizzle-orm';
import type { Database } from '../../shared/db/client';
import { orders, orderItems } from '../../shared/db/schema/orders';
import { payments } from '../../shared/db/schema/payments';
import { listings } from '../../shared/db/schema/listings';
import { canTransition } from '../orders/orders.state-machine';
import type { PaymentProvider } from './payment-provider';

export class WebhookService {
  constructor(
    private readonly db: Database,
    private readonly paymentProvider: PaymentProvider,
  ) {}

  /**
   * Process an incoming webhook callback from the payment provider.
   *
   * Never throws — always returns, even on errors. This prevents
   * provider retry loops. Invalid signatures and missing payments are
   * logged (by the caller) but do not break the response.
   */
  async handleCallback(
    rawBody: Buffer,
    signature: string,
    body: unknown,
  ): Promise<{ handled: boolean; reason?: string }> {
    // 1. Verify signature
    if (!this.paymentProvider.verifyWebhookSignature(rawBody, signature)) {
      return { handled: false, reason: 'invalid_signature' };
    }

    // 2. Parse payload
    let payload;
    try {
      payload = this.paymentProvider.parseWebhookPayload(body);
    } catch {
      return { handled: false, reason: 'parse_failed' };
    }

    // 3. Find payment by external_id
    const paymentRows = await this.db
      .select()
      .from(payments)
      .where(eq(payments.externalId, payload.externalId))
      .limit(1);

    const payment = paymentRows[0];
    if (!payment) {
      return { handled: false, reason: 'payment_not_found' };
    }

    // 4. Load order
    const orderRows = await this.db
      .select()
      .from(orders)
      .where(eq(orders.id, payment.orderId))
      .limit(1);

    const order = orderRows[0];
    if (!order) {
      return { handled: false, reason: 'order_not_found' };
    }

    // 5. Determine target status
    const targetStatus = payload.status === 'paid' ? 'paid' : 'cancelled';

    // 6. Check state machine
    if (!canTransition(order.status, targetStatus)) {
      return { handled: false, reason: 'invalid_transition' };
    }

    // 7. Apply transition
    if (targetStatus === 'paid') {
      await this.db
        .update(orders)
        .set({ status: 'paid' })
        .where(eq(orders.id, order.id));
      await this.db
        .update(payments)
        .set({ status: 'completed' })
        .where(eq(payments.id, payment.id));
    } else {
      // cancelled — restore stock
      await this.db
        .update(orders)
        .set({ status: 'cancelled' })
        .where(eq(orders.id, order.id));
      await this.db
        .update(payments)
        .set({ status: 'failed' })
        .where(eq(payments.id, payment.id));

      // Restore stock from order_items
      const items = await this.db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id));

      for (const item of items) {
        try {
          // Read current stock
          const listingRows = await this.db
            .select({ availableStock: listings.availableStock })
            .from(listings)
            .where(eq(listings.id, item.listingId))
            .limit(1);
          const current = listingRows[0];
          if (current) {
            await this.db
              .update(listings)
              .set({
                availableStock: current.availableStock + item.quantityBoxes,
              })
              .where(eq(listings.id, item.listingId));
          }
        } catch {
          // Best-effort — don't fail the webhook
        }
      }
    }

    return { handled: true };
  }
}
```

- [ ] **Step 2: Create test file with 6 tests**

Create `src/modules/payments/__tests__/payments.service.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WebhookService } from '../payments.service';
import type { Database } from '../../../shared/db/client';
import type { PaymentProvider } from '../payment-provider';

function createDbMock() {
  const db = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  };
  return db as unknown as Database & typeof db;
}

function createProviderMock(signatureValid = true) {
  return {
    createPayment: vi.fn(),
    verifyWebhookSignature: vi.fn().mockReturnValue(signatureValid),
    parseWebhookPayload: vi.fn(),
  } as unknown as PaymentProvider & {
    createPayment: ReturnType<typeof vi.fn>;
    verifyWebhookSignature: ReturnType<typeof vi.fn>;
    parseWebhookPayload: ReturnType<typeof vi.fn>;
  };
}

const paymentRow = {
  id: '00000000-0000-0000-0000-000000000060',
  orderId: '00000000-0000-0000-0000-000000000040',
  provider: 'arcopay' as const,
  externalId: 'mock-ext-id',
  amountUsd: '42.00',
  status: 'pending' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const orderRow = {
  id: paymentRow.orderId,
  status: 'pending' as const,
};

describe('WebhookService', () => {
  let db: ReturnType<typeof createDbMock>;
  let provider: ReturnType<typeof createProviderMock>;
  let service: WebhookService;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createDbMock();
    provider = createProviderMock();
    service = new WebhookService(db, provider);
  });

  it('paid webhook transitions order to paid and payment to completed', async () => {
    provider.parseWebhookPayload.mockReturnValue({
      merchantOrderId: 'FL-20260410-A1B2C3D4',
      externalId: 'mock-ext-id',
      status: 'paid',
    });
    db.limit.mockResolvedValueOnce([paymentRow]);
    db.limit.mockResolvedValueOnce([orderRow]);

    const result = await service.handleCallback(
      Buffer.from('{}'),
      'sig',
      {},
    );

    expect(result.handled).toBe(true);
    // Verify update calls — first for orders, second for payments
    expect(db.update).toHaveBeenCalledTimes(2);
  });

  it('failed webhook cancels order, fails payment, and restores stock', async () => {
    provider.parseWebhookPayload.mockReturnValue({
      merchantOrderId: 'FL-20260410-A1B2C3D4',
      externalId: 'mock-ext-id',
      status: 'failed',
    });
    db.limit.mockResolvedValueOnce([paymentRow]);
    db.limit.mockResolvedValueOnce([orderRow]);
    db.where.mockResolvedValueOnce([
      {
        id: 'item-1',
        orderId: paymentRow.orderId,
        listingId: '00000000-0000-0000-0000-000000000010',
        quantityBoxes: 3,
      },
    ]);
    db.limit.mockResolvedValueOnce([{ availableStock: 50 }]); // current stock

    const result = await service.handleCallback(
      Buffer.from('{}'),
      'sig',
      {},
    );

    expect(result.handled).toBe(true);
    // 1st update: order → cancelled
    // 2nd update: payment → failed
    // 3rd update: listing → stock + 3
    expect(db.update).toHaveBeenCalledTimes(3);
  });

  it('idempotent: paid webhook for already-paid order is no-op', async () => {
    provider.parseWebhookPayload.mockReturnValue({
      merchantOrderId: 'FL-20260410-A1B2C3D4',
      externalId: 'mock-ext-id',
      status: 'paid',
    });
    db.limit.mockResolvedValueOnce([paymentRow]);
    db.limit.mockResolvedValueOnce([{ ...orderRow, status: 'paid' }]);

    const result = await service.handleCallback(
      Buffer.from('{}'),
      'sig',
      {},
    );

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('invalid_transition');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('rejects webhook with invalid signature', async () => {
    provider = createProviderMock(false);
    service = new WebhookService(db, provider);

    const result = await service.handleCallback(
      Buffer.from('{}'),
      'bad-sig',
      {},
    );

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('invalid_signature');
    expect(db.select).not.toHaveBeenCalled();
  });

  it('returns not-found reason when payment does not exist', async () => {
    provider.parseWebhookPayload.mockReturnValue({
      merchantOrderId: 'FL-20260410-A1B2C3D4',
      externalId: 'nonexistent',
      status: 'paid',
    });
    db.limit.mockResolvedValueOnce([]); // payment not found

    const result = await service.handleCallback(
      Buffer.from('{}'),
      'sig',
      {},
    );

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('payment_not_found');
  });

  it('state machine blocks invalid transitions without throwing', async () => {
    provider.parseWebhookPayload.mockReturnValue({
      merchantOrderId: 'FL-20260410-A1B2C3D4',
      externalId: 'mock-ext-id',
      status: 'failed',
    });
    db.limit.mockResolvedValueOnce([paymentRow]);
    // Order is already in shipped state — cannot transition to cancelled
    db.limit.mockResolvedValueOnce([{ ...orderRow, status: 'shipped' }]);

    const result = await service.handleCallback(
      Buffer.from('{}'),
      'sig',
      {},
    );

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('invalid_transition');
    expect(db.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm test
```
Expected: 81 total (75 + 6).

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm typecheck
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/modules/payments/payments.service.ts backend/src/modules/payments/__tests__/payments.service.test.ts
git commit -m "feat(backend/payments): WebhookService — 6 TDD tests

Handles provider callbacks: signature verification, payload parsing,
state machine validation, order+payment status updates, and best-effort
stock restoration on failed payments. Never throws — returns structured
{ handled, reason } result so the webhook route can always send 200 OK."
```

---

## Task 13: `orders.router.ts` — 7 routes

**Files:**
- Rewrite: `src/modules/orders/orders.router.ts`

- [ ] **Step 1: Replace the stub with full router**

Replace `src/modules/orders/orders.router.ts`:
```ts
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { OrdersService } from './orders.service';
import {
  addCartItemBodySchema,
  cartItemParamsSchema,
  cartQuerySchema,
  cartItemResponseSchema,
  cartResponseSchema,
  createOrderBodySchema,
  createOrderResponseSchema,
  orderIdParamsSchema,
  orderDetailSchema,
  ordersListQuerySchema,
  ordersListResponseSchema,
  updateCartItemBodySchema,
} from './orders.schema';

export function buildOrdersRouter(
  ordersService: OrdersService,
  options: { authenticate: FastifyInstance['authenticate'] },
): FastifyPluginAsync {
  const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    // Cart routes

    typed.post(
      '/cart/items',
      {
        preHandler: [options.authenticate],
        schema: {
          tags: ['cart'],
          body: addCartItemBodySchema,
          response: { 201: cartItemResponseSchema },
        },
      },
      async (request, reply) => {
        const result = await ordersService.addCartItem(
          request.user!.id,
          request.body,
        );
        reply.status(201);
        return result;
      },
    );

    typed.get(
      '/cart',
      {
        preHandler: [options.authenticate],
        schema: {
          tags: ['cart'],
          querystring: cartQuerySchema,
          response: { 200: cartResponseSchema },
        },
      },
      async (request) => {
        return ordersService.getCart(request.user!.id, request.query.currency);
      },
    );

    typed.patch(
      '/cart/items/:id',
      {
        preHandler: [options.authenticate],
        schema: {
          tags: ['cart'],
          params: cartItemParamsSchema,
          body: updateCartItemBodySchema,
          response: { 200: cartItemResponseSchema },
        },
      },
      async (request) => {
        return ordersService.updateCartItem(
          request.user!.id,
          request.params.id,
          request.body,
        );
      },
    );

    typed.delete(
      '/cart/items/:id',
      {
        preHandler: [options.authenticate],
        schema: {
          tags: ['cart'],
          params: cartItemParamsSchema,
        },
      },
      async (request, reply) => {
        await ordersService.removeCartItem(request.user!.id, request.params.id);
        reply.status(204);
        return;
      },
    );

    // Order routes

    typed.post(
      '/orders',
      {
        preHandler: [options.authenticate],
        schema: {
          tags: ['orders'],
          body: createOrderBodySchema,
          response: { 201: createOrderResponseSchema },
        },
      },
      async (request, reply) => {
        const result = await ordersService.createOrder(
          request.user!.id,
          request.body,
        );
        reply.status(201);
        return result;
      },
    );

    typed.get(
      '/orders',
      {
        preHandler: [options.authenticate],
        schema: {
          tags: ['orders'],
          querystring: ordersListQuerySchema,
          response: { 200: ordersListResponseSchema },
        },
      },
      async (request) => {
        return ordersService.listOrders(
          request.user!.id,
          request.query.page,
          request.query.limit,
        );
      },
    );

    typed.get(
      '/orders/:id',
      {
        preHandler: [options.authenticate],
        schema: {
          tags: ['orders'],
          params: orderIdParamsSchema,
          response: { 200: orderDetailSchema },
        },
      },
      async (request) => {
        return ordersService.getOrderById(request.user!.id, request.params.id);
      },
    );
  };

  return plugin;
}
```

**Note:** `createOrder` takes only `userId` and `input`. Email is not needed because `MockPaymentProvider` ignores `buyerEmail`. When real ArcoPay integration lands, the service will look up the email from the `users` table inside `createOrder` — one small extra DB query, no signature change to the router.

- [ ] **Step 2: Typecheck + tests**

```bash
pnpm typecheck
pnpm test
```
Expected: 81 tests still pass (router is not unit-tested).

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/modules/orders/orders.router.ts
git commit -m "feat(backend/orders): router with 7 protected endpoints

4 cart routes (POST /cart/items, GET /cart, PATCH and DELETE
/cart/items/:id) + 3 order routes (POST /orders, GET /orders,
GET /orders/:id). All guarded by authenticate preHandler."
```

---

## Task 14: `payments.router.ts` — webhook route

**Files:**
- Create: `src/modules/payments/payments.router.ts`

- [ ] **Step 1: Create the webhook router**

Create `src/modules/payments/payments.router.ts`:
```ts
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { WebhookService } from './payments.service';

interface WebhookRequest extends FastifyRequest {
  rawBody?: Buffer;
}

export function buildPaymentsRouter(
  webhookService: WebhookService,
): FastifyPluginAsync {
  const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
    // Content-type parser that captures raw body for signature verification.
    // Scoped to this plugin so it does not affect other routes.
    app.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (req, body, done) => {
        try {
          (req as unknown as WebhookRequest).rawBody = body as Buffer;
          const parsed = JSON.parse((body as Buffer).toString());
          done(null, parsed);
        } catch (err) {
          done(err as Error);
        }
      },
    );

    app.post('/payments/callback', async (request, reply) => {
      const typedReq = request as WebhookRequest;
      const signature = (request.headers['payment-sign'] as string) ?? '';
      const rawBody = typedReq.rawBody ?? Buffer.from('');

      try {
        const result = await webhookService.handleCallback(
          rawBody,
          signature,
          request.body,
        );
        if (!result.handled) {
          request.log.warn(
            { reason: result.reason },
            'payment webhook not handled',
          );
        }
      } catch (err) {
        request.log.error({ err }, 'payment webhook handler threw');
      }

      // Always return 200 OK to prevent provider retry loops
      reply.status(200);
      return { success: true };
    });
  };

  return plugin;
}
```

- [ ] **Step 2: Typecheck + tests**

```bash
pnpm typecheck
pnpm test
```

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/modules/payments/payments.router.ts
git commit -m "feat(backend/payments): webhook router with raw body capture

POST /payments/callback handles provider callbacks. Uses a plugin-scoped
addContentTypeParser to capture raw request body (needed for future RSA
signature verification). Always returns 200 OK — errors are logged, not
propagated, to prevent provider retry loops."
```

---

## Task 15: Wire into `app.ts`

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Update `app.ts`**

Read current state first:
```bash
cat src/app.ts
```

Add imports near the top:
```ts
import { OrdersService } from './modules/orders/orders.service';
import { buildOrdersRouter } from './modules/orders/orders.router';
import { MockPaymentProvider } from './modules/payments/mock-payment-provider';
import { WebhookService } from './modules/payments/payments.service';
import { buildPaymentsRouter } from './modules/payments/payments.router';
```

Remove the old stub import (if still present):
```ts
// REMOVE: import { ordersRouter } from './modules/orders/orders.router';
```

After `catalogService` creation (or after the `authService` decorator, wherever fits the existing order), add:
```ts
const paymentProvider = new MockPaymentProvider();

const ordersService = new OrdersService(db, fxService, paymentProvider, {
  commissionPercent: env.PLATFORM_COMMISSION_PERCENT,
  cartTtlHours: 24,
  callbackUrl: `http://${env.HOST}:${env.PORT}/api/v1/payments/callback`,
  successUrl: 'http://localhost:5173/orders/{orderId}/success',
  failUrl: 'http://localhost:5173/orders/{orderId}/fail',
});

const webhookService = new WebhookService(db, paymentProvider);
```

In the route registration block, replace the old `api.register(ordersRouter)` line with:
```ts
await api.register(
  buildOrdersRouter(ordersService, {
    authenticate: app.authenticate,
  }),
);
await api.register(buildPaymentsRouter(webhookService));
```

**Note on the `successUrl` / `failUrl`:** hardcoded to `localhost:5173` for MVP dev. Move to env vars when needed.

- [ ] **Step 2: Typecheck + tests**

```bash
pnpm typecheck
pnpm test
```
Expected: 81 tests pass.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Антон/projects/FINEXT/flowers"
git add backend/src/app.ts
git commit -m "feat(backend): wire OrdersService, PaymentProvider, WebhookService into app.ts

Instantiates MockPaymentProvider, OrdersService, and WebhookService.
Registers /api/v1 orders router (with authenticate preHandler) and
/api/v1 payments router (public webhook)."
```

---

## Task 16: Manual smoke test

**Files:** none — verification only.

**Prerequisites:** Docker running, migration 0001 applied, `.env` with valid JWT secrets.

- [ ] **Step 1: Start dev server**

```bash
pnpm dev &
sleep 3
curl -s http://localhost:3000/health
```
Expected: `{"status":"ok"}`

- [ ] **Step 2: Register a fresh buyer and get access token**

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -c /tmp/cookies.txt \
  -d '{"email":"smoke-orders@example.com","password":"correct-horse-battery","companyName":"Smoke Test Co"}'
```
Save the `accessToken` from the response into a shell variable:
```bash
TOKEN="<paste accessToken here>"
```

- [ ] **Step 3: Get a listing ID from the catalog**

```bash
curl -s http://localhost:3000/api/v1/products | head -80
```
Copy a listing `id` from the first item into a variable:
```bash
LISTING_ID="<paste listing id here>"
```

- [ ] **Step 4: Add item to cart**

```bash
curl -i -X POST http://localhost:3000/api/v1/cart/items \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"listingId\":\"$LISTING_ID\",\"quantityBoxes\":2}"
```
Expected: 201 with cart item. Save the `id` as `CART_ITEM_ID`.

- [ ] **Step 5: Add same item again (should fail)**

```bash
curl -i -X POST http://localhost:3000/api/v1/cart/items \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"listingId\":\"$LISTING_ID\",\"quantityBoxes\":1}"
```
Expected: 409 `ITEM_ALREADY_IN_CART`.

- [ ] **Step 6: Get cart**

```bash
curl -s http://localhost:3000/api/v1/cart \
  -H "Authorization: Bearer $TOKEN"
```
Expected: 200 with cart, 1 item, computed subtotal/commission/total.

- [ ] **Step 7: Update quantity**

```bash
curl -i -X PATCH "http://localhost:3000/api/v1/cart/items/$CART_ITEM_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"quantityBoxes":5}'
```
Expected: 200 with updated quantity.

- [ ] **Step 8: Create order**

```bash
curl -i -X POST http://localhost:3000/api/v1/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "shippingAddress": {
      "address": "123 Flower Ave, Miami, FL 33101",
      "contactName": "John Smith",
      "contactPhone": "+1-305-555-0100"
    },
    "notes": "Smoke test order"
  }'
```
Expected: 201 with:
- `order.status: "pending"`
- `order.items[0].unitPriceUsd` is a snapshot of the listing price
- `order.commissionUsd` = subtotal × 0.12
- `paymentUrl: "https://mock-pay.example.com/FL-20260410-..."`

Save the `order.id` as `ORDER_ID` and the payment `externalId` (from the order — it's not returned; you'd need to check DB or just use the merchantOrderId format).

- [ ] **Step 9: List orders**

```bash
curl -s http://localhost:3000/api/v1/orders \
  -H "Authorization: Bearer $TOKEN"
```
Expected: 1 order in `data`.

- [ ] **Step 10: Get order detail**

```bash
curl -s "http://localhost:3000/api/v1/orders/$ORDER_ID" \
  -H "Authorization: Bearer $TOKEN"
```
Expected: order with full items array.

- [ ] **Step 11: Simulate payment webhook — success**

Get the payment's `external_id` and `merchantOrderId` from the DB:
```bash
docker exec flowers-postgres psql -U flowers -d flowers_db -c "
SELECT p.external_id, o.merchant_order_id
FROM payments p
JOIN orders o ON p.order_id = o.id
WHERE o.id = '$ORDER_ID';
"
```
Save as `EXTERNAL_ID` and `MERCHANT_ID`.

Send a mock webhook:
```bash
curl -i -X POST http://localhost:3000/api/v1/payments/callback \
  -H 'Content-Type: application/json' \
  -H 'payment-sign: mock-sig' \
  -d "{\"merchantOrderId\":\"$MERCHANT_ID\",\"externalId\":\"$EXTERNAL_ID\",\"status\":\"paid\"}"
```
Expected: 200 OK.

- [ ] **Step 12: Verify order status changed to paid**

```bash
curl -s "http://localhost:3000/api/v1/orders/$ORDER_ID" \
  -H "Authorization: Bearer $TOKEN"
```
Expected: `status: "paid"`.

- [ ] **Step 13: Try to transition back (should be idempotent no-op)**

```bash
curl -i -X POST http://localhost:3000/api/v1/payments/callback \
  -H 'Content-Type: application/json' \
  -H 'payment-sign: mock-sig' \
  -d "{\"merchantOrderId\":\"$MERCHANT_ID\",\"externalId\":\"$EXTERNAL_ID\",\"status\":\"failed\"}"
```
Expected: 200 OK. Order status remains `paid` (state machine blocks the invalid transition).

- [ ] **Step 14: Stop server + final tests**

```bash
kill %1 2>/dev/null || true
pnpm test
pnpm typecheck
```
Expected: 81 tests pass, typecheck clean.

---

## Out of scope

Intentionally NOT in this plan:

- Real ArcoPay integration (`ArcoPayPaymentProvider`)
- Admin endpoints for manual state transitions
- Buyer-initiated order cancellation
- Order retry flow for stuck `pending` orders
- Cart cleanup cron for expired carts
- Order confirmation emails
- Inventory reservations with TTL
- Split shipping UI (schema supports it via order_items.seller_id)
- Refunds
- Frontend: order detail page, payment redirect handling
