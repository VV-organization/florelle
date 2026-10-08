export function offerWriteContract(attributes: Record<string, unknown>) {
  const schema = {
    type: "object",
    properties: {
      productId: {
        type: "string",
        minLength: 1,
      },
      sellerId: {
        type: "string",
        minLength: 1,
      },
      price: {
        type: "object",
        properties: {
          amountMinor: {
            type: "integer",
            minimum: 0,
          },
          currency: {
            type: "string",
            enum: ["RUB", "USD"],
          },
          scale: {
            type: "integer",
            enum: [100],
          },
        },
        required: ["amountMinor", "currency", "scale"],
        additionalProperties: false,
      },
      availability: {
        type: "object",
        properties: {
          quantity: {
            type: "integer",
            minimum: 0,
          },
          unit: {
            type: "string",
            enum: ["stem"],
          },
        },
        required: ["quantity", "unit"],
        additionalProperties: false,
      },
      packageQuantity: {
        type: "integer",
        minimum: 1,
      },
      isActive: {
        type: "boolean",
      },
    },
    additionalProperties: false,
  } as const;
  const input = {
    ...schema,
    properties: {
      ...schema.properties,
      attributes: { ...attributes, additionalProperties: false },
    },
  };
  return {
    version: 1,
    create: {
      ...input,
      required: [
        "productId",
        "sellerId",
        "price",
        "availability",
        "packageQuantity",
        "isActive",
      ],
    },
    update: input,
    delete: true,
  } as const;
}

export function productWriteContract(attributes: Record<string, unknown>) {
  const input = {
    type: "object",
    additionalProperties: false,
    properties: {
      categoryId: { type: ["string", "null"] },
      title: { type: "object" },
      slug: { type: "string", minLength: 1 },
      description: { type: ["object", "null"] },
      media: { type: "array" },
      sortOrder: { type: "integer" },
      isActive: { type: "boolean" },
      attributes: { ...attributes, additionalProperties: false },
    },
  };
  return {
    version: 1,
    create: {
      ...input,
      required: [
        "categoryId",
        "title",
        "slug",
        "media",
        "sortOrder",
        "isActive",
      ],
    },
    update: input,
    delete: true,
  } as const;
}
