ALTER TABLE "sellers" ALTER COLUMN "name" SET DATA TYPE jsonb USING jsonb_build_object('en', name, 'ru', name);--> statement-breakpoint
ALTER TABLE "categories" ALTER COLUMN "name" SET DATA TYPE jsonb USING jsonb_build_object('en', name, 'ru', name);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "name" SET DATA TYPE jsonb USING jsonb_build_object('en', name, 'ru', name);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "description" SET DATA TYPE jsonb USING CASE WHEN description IS NOT NULL THEN jsonb_build_object('en', description, 'ru', description) ELSE NULL END;--> statement-breakpoint
ALTER TABLE "collections" ALTER COLUMN "name" SET DATA TYPE jsonb USING jsonb_build_object('en', name, 'ru', name);