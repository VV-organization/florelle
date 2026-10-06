ALTER TABLE orders ADD COLUMN checkout_key text;
ALTER TABLE orders ADD COLUMN request_hash text;
ALTER TABLE orders ADD COLUMN snapshot jsonb;
CREATE UNIQUE INDEX orders_buyer_checkout_key ON orders(buyer_id,checkout_key) WHERE checkout_key IS NOT NULL;
CREATE TABLE checkout_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
 merchant_order_id text NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'created' CHECK (state IN ('created','creating','review','created_external','ready','paid','failed')),
 amount_minor bigint NOT NULL CHECK (amount_minor > 0),
 currency text NOT NULL DEFAULT 'RUB',
 external_id text UNIQUE,
 payment_url text,
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
