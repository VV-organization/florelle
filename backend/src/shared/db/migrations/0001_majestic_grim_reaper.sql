ALTER TABLE "orders" ADD COLUMN "merchant_order_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_merchant_order_id_unique" UNIQUE("merchant_order_id");