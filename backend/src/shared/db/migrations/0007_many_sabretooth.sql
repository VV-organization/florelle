DO $$ BEGIN
 CREATE TYPE "public"."balance_top_up_status" AS ENUM('pending', 'completed', 'failed', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."balance_transaction_type" AS ENUM('top_up', 'purchase', 'refund', 'adjustment');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "balance_top_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"merchant_order_id" text NOT NULL,
	"arcopay_order_id" text,
	"amount_usd" numeric(12, 2) NOT NULL,
	"amount_rub" numeric(12, 2) NOT NULL,
	"fx_rate" numeric(18, 6) NOT NULL,
	"payment_url" text,
	"buyer_email" text,
	"buyer_phone" text,
	"status" "balance_top_up_status" DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balance_top_ups_merchant_order_id_unique" UNIQUE("merchant_order_id"),
	CONSTRAINT "balance_top_ups_arcopay_order_id_unique" UNIQUE("arcopay_order_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "balance_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "balance_transaction_type" NOT NULL,
	"amount_usd" numeric(12, 2) NOT NULL,
	"balance_after_usd" numeric(12, 2) NOT NULL,
	"top_up_id" uuid,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "balance_usd" numeric(12, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "balance_top_ups" ADD CONSTRAINT "balance_top_ups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "balance_transactions" ADD CONSTRAINT "balance_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "balance_transactions" ADD CONSTRAINT "balance_transactions_top_up_id_balance_top_ups_id_fk" FOREIGN KEY ("top_up_id") REFERENCES "public"."balance_top_ups"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "balance_transactions" ADD CONSTRAINT "balance_transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
