ALTER TABLE "orders" ALTER COLUMN "display_currency" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "display_currency" TYPE text USING "display_currency"::text;--> statement-breakpoint
UPDATE "orders" SET "display_currency" = 'TRY' WHERE "display_currency" = 'EUR';--> statement-breakpoint
DROP TYPE "public"."display_currency";--> statement-breakpoint
CREATE TYPE "public"."display_currency" AS ENUM('USD', 'TRY', 'RUB');--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "display_currency" TYPE "public"."display_currency" USING "display_currency"::"public"."display_currency";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "display_currency" SET DEFAULT 'TRY';
