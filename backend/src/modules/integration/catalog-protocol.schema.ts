import { z } from 'zod';

const localizedText = z
  .union([
    z.string().trim().min(1),
    z.object({ ru: z.string().trim().min(1), en: z.string().trim().min(1).optional() }),
  ])
  .transform((value) =>
    typeof value === 'string' ? { ru: value, en: value } : { ru: value.ru, en: value.en ?? value.ru },
  );

const nullableLocalizedText = z
  .union([z.string(), z.object({ ru: z.string(), en: z.string().optional() })])
  .nullable()
  .optional()
  .transform((value) => {
    if (value == null) return null;
    return typeof value === 'string'
      ? { ru: value, en: value }
      : { ru: value.ru, en: value.en ?? value.ru };
  });

export const catalogMediaSchema = z
  .object({
    id: z.string().trim().min(1),
    url: z.union([z.string().url(),z.string().regex(/^\/media\/[a-f0-9]{64}\.(jpg|jpeg|png|webp|gif|svg|avif)$/)]),
    alt: z.union([z.string(), z.object({ ru: z.string(), en: z.string().optional() })]).nullable(),
  })
  .strict();

const attributesSchema = z.record(z.unknown()).default({});

export const categoryCreateSchema = z
  .object({
    parentId: z.string().uuid().nullable(),
    name: localizedText,
    slug: z.string().trim().min(1).max(160),
    image: catalogMediaSchema.nullable(),
    sortOrder: z.number().int(),
    isActive: z.boolean(),
  })
  .strict();

export const categoryUpdateSchema = categoryCreateSchema.partial().strict();

export const productCreateSchema = z
  .object({
    categoryId: z.string().uuid().nullable(),
    title: localizedText,
    slug: z.string().trim().min(1).max(160),
    description: nullableLocalizedText,
    media: z.array(catalogMediaSchema).max(1),
    sortOrder: z.number().int(),
    isActive: z.boolean(),
    attributes: attributesSchema,
  })
  .strict();

export const productUpdateSchema = productCreateSchema.partial().strict();

const moneySchema = z
  .object({
    amountMinor: z.number().int().nonnegative(),
    currency: z.enum(['RUB','USD']),
    scale: z.literal(100),
  })
  .strict();

const availabilitySchema = z
  .object({
    quantity: z.number().int().nonnegative(),
    unit: z.string().min(1),
  })
  .strict();

const sellerAttributesSchema = z
  .object({
    country: z.string().trim().min(1).max(80),
    rating: z.number().int().min(0).max(100).optional(),
    verified: z.boolean().optional(),
  })
  .strict();

export const offerCreateSchema = z
  .object({
    productId: z.string().uuid(),
    sellerId: z.string().uuid(),
    price: moneySchema,
    availability: availabilitySchema,
    minimumQuantity: z.number().int().positive().nullable().optional(),
    packageQuantity: z.number().int().positive().nullable(),
    isActive: z.boolean(),
    attributes: z.object({ retailPrice: z.string().optional() }).strict(),
  })
  .strict();

export const offerUpdateSchema = offerCreateSchema.partial().strict();

export const sellerCreateSchema = z
  .object({
    title: localizedText,
    slug: z.string().trim().min(1).max(160),
    image: catalogMediaSchema.nullable(),
    isActive: z.boolean(),
    attributes: sellerAttributesSchema,
  })
  .strict();

export const sellerUpdateSchema = sellerCreateSchema
  .extend({
    attributes: sellerAttributesSchema.partial().optional(),
  })
  .partial()
  .strict();

export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;
export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
export type OfferCreateInput = z.infer<typeof offerCreateSchema>;
export type OfferUpdateInput = z.infer<typeof offerUpdateSchema>;
export type SellerCreateInput = z.infer<typeof sellerCreateSchema>;
export type SellerUpdateInput = z.infer<typeof sellerUpdateSchema>;
