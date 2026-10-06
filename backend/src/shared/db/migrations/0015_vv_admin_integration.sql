CREATE TABLE "vv_admin_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vv_admin_outbox_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "vv_admin_outbox_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "vv_admin_outbox_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbox_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" text NOT NULL,
	"http_status" integer,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "vv_admin_outbox_attempts_outbox_attempt_number" UNIQUE("outbox_id","attempt_number")
);
--> statement-breakpoint
ALTER TABLE "vv_admin_outbox_attempts" ADD CONSTRAINT "vv_admin_outbox_attempts_outbox_id_vv_admin_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."vv_admin_outbox"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "synthetic" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "scenario_run_id" uuid;
