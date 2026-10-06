ALTER TABLE "orders" ADD COLUMN "delivery_fee_usd" numeric(12, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "estimated_delivery_weight_kg" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "estimated_delivery_stems" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_country_code" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_city_value" text;
