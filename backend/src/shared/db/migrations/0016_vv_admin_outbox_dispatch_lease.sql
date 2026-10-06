ALTER TABLE "vv_admin_outbox" ADD COLUMN "dispatch_lease_expires_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "vv_admin_outbox"
SET "dispatch_lease_expires_at" = now()
WHERE "status" = 'sending' AND "dispatch_lease_expires_at" IS NULL;
