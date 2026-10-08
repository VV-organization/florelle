import { test } from "vitest";
import assert from "node:assert/strict";
import { offerCreateSchema, offerUpdateSchema } from "../catalog-protocol.schema";
import { flowerPointCatalogCapability } from "../catalog-protocol.service";

test("Florelle catalog exposes retail pricing without AMS attributes", () => {
 const capability = JSON.stringify(flowerPointCatalogCapability('https://bloom-send.com'));
 assert.equal(capability.includes('amsPriceUsd'), false);
 assert.equal(capability.includes('referencePrice'), false);
 assert.equal(capability.includes('retailPrice'), true);
 assert.equal(capability.includes('\"delivery\"'), false);
 assert.equal(offerUpdateSchema.safeParse({delivery:{kind:'date',value:'2099-01-01'}}).success, false);
 assert.equal(offerUpdateSchema.safeParse({attributes:{retailPrice:'100.00'}}).success, true);
 for (const key of ['amsPriceUsd','referencePrice']) {
  assert.equal(offerUpdateSchema.safeParse({attributes:{[key]:'100.00'}}).success, false);
 }
});

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
  "packageQuantity": 10
}).success, true);
});
test("partial offer updates do not inject omitted fields", () => {
 assert.deepEqual(offerUpdateSchema.parse({isActive:false}), {isActive:false});
});
