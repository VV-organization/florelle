ALTER TABLE email_verification_challenges ADD COLUMN registration_payload jsonb;
--> statement-breakpoint
-- Old challenges were not bound to submitted credentials. Require fresh registration.
UPDATE email_verification_challenges SET consumed_at = now() WHERE consumed_at IS NULL;
