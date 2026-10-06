ALTER TABLE products ADD COLUMN IF NOT EXISTS photo jsonb;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS price_currency text;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS wholesale_price numeric(18,6);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS retail_price numeric(18,6);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS reference_price numeric(18,6);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS media_assets (source_path text PRIMARY KEY, checksum text NOT NULL, filename text NOT NULL, bytes integer NOT NULL, content_type text NOT NULL, metadata jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS storefront_settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
