ALTER TABLE "listings" RENAME COLUMN "available_stock" TO "available_stems";
UPDATE "listings" SET "available_stems" = "available_stems" * "box_quantity";