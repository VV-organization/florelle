ALTER TABLE "sellers" ADD COLUMN "slug" text;
--> statement-breakpoint
ALTER TABLE "sellers" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
UPDATE "sellers"
SET "slug" = concat(
  regexp_replace(
    lower(coalesce("name"->>'en', "name"->>'ru', "id"::text)),
    '[^a-z0-9]+',
    '-',
    'g'
  ),
  '-',
  substring("id"::text from 1 for 8)
)
WHERE "slug" IS NULL;
--> statement-breakpoint
ALTER TABLE "sellers" ALTER COLUMN "slug" SET NOT NULL;
