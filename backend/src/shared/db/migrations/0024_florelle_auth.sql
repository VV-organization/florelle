ALTER TABLE users ADD COLUMN IF NOT EXISTS name text;
UPDATE users SET name = NULLIF(BTRIM(CONCAT_WS(' ', first_name, last_name)), '') WHERE name IS NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_customer_type_fields_chk;
ALTER TABLE users ADD CONSTRAINT users_customer_type_fields_chk CHECK (
  (customer_type = 'legal_entity' AND NULLIF(BTRIM(company_name), '') IS NOT NULL)
  OR
  (customer_type = 'individual'
    AND (NULLIF(BTRIM(name), '') IS NOT NULL OR (first_name IS NOT NULL AND last_name IS NOT NULL)))
);
