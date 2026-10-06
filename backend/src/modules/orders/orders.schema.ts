import { z } from 'zod';
import {
  currencySchema,
  langSchema,
  pricingCurrencySchema,
  segmentSchema,
} from '../catalog/catalog.schema';

// Cart request schemas
export const addCartItemBodySchema = z.object({
  listingId: z.string().uuid(),
  quantity: z.coerce.number().int().positive(),
  segment: segmentSchema,
});

export const updateCartItemBodySchema = z.object({
  quantity: z.coerce.number().int().positive(),
  segment: segmentSchema,
});

export const cartItemParamsSchema = z.object({
  id: z.string().uuid(),
});

export const cartQuerySchema = z.object({
  currency: pricingCurrencySchema.default('TRY'),
  lang: langSchema,
});

// Order request schemas
export const shippingAddressSchema = z.object({
  address: z.string().min(10).max(500),
  contactName: z.string().min(2).max(200),
  contactPhone: z.string().min(5).max(50),
});

export const deliverySelectionSchema = z.object({
  countryCode: z.enum(['RU', 'KZ', 'TR']),
  cityValue: z.string().min(1).max(100),
});

export const createOrderBodySchema = z
  .object({
    shippingAddress: shippingAddressSchema,
    delivery: deliverySelectionSchema.optional(),
    notes: z.string().max(1000).optional(),
    displayCurrency: currencySchema.optional(),
    segment: segmentSchema,
  })
  .superRefine((value, ctx) => {
    if (value.segment === 'b2b' && !value.delivery) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['delivery'],
        message: 'Delivery selection is required for B2B orders',
      });
    }
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
  quantity: z.number().int(),
  createdAt: z.string(),
});

export const cartResponseSchema = z.object({
  id: z.string().uuid(),
  expiresAt: z.string(),
  items: z.array(
    z.object({
      id: z.string().uuid(),
      listing: listingRefSchema,
      quantity: z.number().int(),
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
  quantity: z.number().int(),
  unitPriceUsd: z.string(),
  totalPriceUsd: z.string(),
  deliveryDate: z.string(),
});

export const orderDetailSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'paid', 'shipped', 'delivered', 'cancelled']),
  subtotalUsd: z.string(),
  commissionUsd: z.string(),
  deliveryFeeUsd: z.string(),
  estimatedDeliveryWeightKg: z.number().int(),
  estimatedDeliveryStems: z.number().int(),
  deliveryCountryCode: z.enum(['RU', 'KZ', 'TR']).nullable(),
  deliveryCityValue: z.string().nullable(),
  totalUsd: z.string(),
  displayCurrency: z.enum(['KZT', 'TRY', 'RUB']),
  shippingAddress: shippingAddressSchema,
  notes: z.string().nullable(),
  items: z.array(orderItemResponseSchema),
  createdAt: z.string(),
});

export const orderSummarySchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'paid', 'shipped', 'delivered', 'cancelled']),
  totalUsd: z.string(),
  displayCurrency: z.enum(['KZT', 'TRY', 'RUB']),
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
  paymentUrl: z.string().url(),
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
