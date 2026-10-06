import { test } from "vitest";
import assert from "node:assert/strict";
import { offerCreateSchema, offerUpdateSchema } from "../catalog-protocol.schema";

test("offer creation accepts only persisted fields without unused logistics keys", () => {
 assert.equal(offerCreateSchema.safeParse({
  "productId": "5ad26f6b-9a93-4cff-bcf5-4a9aa2c671d5",
  "sellerId": "5ad26f6b-9a93-4cff-bcf5-4a9aa2c671d6",
  "price": {
    "amountMinor": 20000,
    "currency": "USD",
    "scale": 100
  },
  "availability": {
    "quantity": 1,
    "unit": "stem"
  },
  "isActive": false,
  "attributes": {},
  "delivery": {
    "kind": "date",
    "value": "2026-09-17"
  },
  "packageQuantity": 10
}).success, true);
});
test("partial offer updates do not inject omitted fields", () => {
 assert.deepEqual(offerUpdateSchema.parse({isActive:false}), {isActive:false});
});
