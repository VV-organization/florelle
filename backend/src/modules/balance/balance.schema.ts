import { z } from 'zod';

const moneyStringSchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Expected money amount with up to 2 decimals');

export const createTopUpBodySchema = z.object({
  amountUsd: moneyStringSchema,
  buyerEmail: z.string().email().optional(),
  buyerPhone: z.string().min(5).max(50).optional(),
});

export const topUpIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const balanceResponseSchema = z.object({
  balanceUsd: z.string(),
});

export const topUpSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'completed', 'failed', 'cancelled']),
  amountUsd: z.string(),
  amountRub: z.string(),
  fxRate: z.string(),
  merchantOrderId: z.string(),
  paymentUrl: z.string().nullable(),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
});

export const createTopUpResponseSchema = z.object({
  topUp: topUpSchema,
  paymentUrl: z.string(),
});

export const topUpResponseSchema = z.object({
  topUp: topUpSchema,
});

export const topUpsListResponseSchema = z.object({
  data: z.array(topUpSchema),
});

export const balanceTransactionSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['top_up', 'purchase', 'refund', 'adjustment']),
  amountUsd: z.string(),
  balanceAfterUsd: z.string(),
  topUpId: z.string().uuid().nullable(),
  orderId: z.string().uuid().nullable(),
  createdAt: z.string(),
});

export const balanceTransactionsResponseSchema = z.object({
  data: z.array(balanceTransactionSchema),
});

export type CreateTopUpBody = z.infer<typeof createTopUpBodySchema>;
