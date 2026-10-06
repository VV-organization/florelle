ALTER TABLE "carts" ADD COLUMN "checkout_merchant_order_id" text;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "checkout_claimed_at" timestamp with time zone;
