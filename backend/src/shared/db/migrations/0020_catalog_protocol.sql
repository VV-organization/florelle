ALTER TABLE "categories" ADD COLUMN "parent_id" uuid;
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "image_url" text;
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TYPE "catalog_protocol_operation_state" AS ENUM('in_progress', 'completed', 'failed');
--> statement-breakpoint
CREATE TABLE "catalog_protocol_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_key" varchar(128) NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"actor_id" varchar(128) NOT NULL,
	"request_id" uuid NOT NULL,
	"method" varchar(10) NOT NULL,
	"path" text NOT NULL,
	"state" "catalog_protocol_operation_state" NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_protocol_operations_site_idem_idx" ON "catalog_protocol_operations" USING btree ("site_key","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_protocol_operations_site_request_idx" ON "catalog_protocol_operations" USING btree ("site_key","request_id");
