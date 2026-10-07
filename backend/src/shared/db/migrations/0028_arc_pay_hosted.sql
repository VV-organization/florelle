ALTER TYPE payment_provider ADD VALUE IF NOT EXISTS 'arc_pay';
--> statement-breakpoint
ALTER TABLE checkout_attempts
 ADD COLUMN provider text NOT NULL DEFAULT 'arcopay',
 ADD COLUMN environment text,
 ADD COLUMN session_id text UNIQUE,
 ADD COLUMN request_snapshot jsonb,
 ADD COLUMN first_request_at timestamptz,
 ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN retry_count integer NOT NULL DEFAULT 0,
 ADD COLUMN lease_token uuid,
 ADD COLUMN provider_status text,
 ADD COLUMN review_reason text;
CREATE INDEX checkout_attempts_arc_due ON checkout_attempts(provider, state, next_attempt_at);
CREATE TABLE arc_pay_events (
 id text PRIMARY KEY,
 environment text NOT NULL,
 event_type text NOT NULL,
 payment_id text NOT NULL,
 status text NOT NULL DEFAULT 'received',
 reason text,
 retry_count integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,
 lease_token uuid,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX arc_pay_events_due ON arc_pay_events(status,next_attempt_at);
CREATE TABLE payment_emails (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
 payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending',
 retry_count integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,
 lease_token uuid,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_emails_due ON payment_emails(status,next_attempt_at);
