ALTER TABLE "order_items" ADD COLUMN "reserved_stems" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "order_items"
SET "reserved_stems" = CASE
  WHEN COALESCE("users"."customer_type", 'legal_entity') = 'individual'
    THEN "order_items"."quantity"
  ELSE "order_items"."quantity" * "listings"."box_quantity"
END
FROM "orders", "users", "listings"
WHERE "order_items"."order_id" = "orders"."id"
  AND "orders"."buyer_id" = "users"."id"
  AND "order_items"."listing_id" = "listings"."id";
