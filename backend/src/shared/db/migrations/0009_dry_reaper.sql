WITH ranked_cart_items AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "cart_id", "listing_id"
      ORDER BY "created_at", "id"
    ) AS "row_number",
    SUM("quantity") OVER (
      PARTITION BY "cart_id", "listing_id"
    )::integer AS "total_quantity"
  FROM "cart_items"
),
updated_kept_cart_items AS (
  UPDATE "cart_items"
  SET "quantity" = ranked_cart_items."total_quantity"
  FROM ranked_cart_items
  WHERE "cart_items"."id" = ranked_cart_items."id"
    AND ranked_cart_items."row_number" = 1
  RETURNING "cart_items"."id"
)
DELETE FROM "cart_items"
USING ranked_cart_items
WHERE "cart_items"."id" = ranked_cart_items."id"
  AND ranked_cart_items."row_number" > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cart_items_cart_id_listing_id_idx" ON "cart_items" USING btree ("cart_id","listing_id");
