DO $$ BEGIN
 CREATE TYPE "public"."customer_type" AS ENUM('individual', 'legal_entity');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "company_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "customer_type" "customer_type" DEFAULT 'legal_entity' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_customer_type_fields_chk" CHECK ((
  (customer_type = 'legal_entity' AND company_name IS NOT NULL AND first_name IS NULL AND last_name IS NULL AND phone IS NULL)
  OR
  (customer_type = 'individual' AND company_name IS NULL AND first_name IS NOT NULL AND last_name IS NOT NULL AND phone IS NOT NULL)
));