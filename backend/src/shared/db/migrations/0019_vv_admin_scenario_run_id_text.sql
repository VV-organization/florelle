DROP INDEX IF EXISTS "orders_scenario_run_id_unique_idx";
--> statement-breakpoint
ALTER TABLE "orders"
ALTER COLUMN "scenario_run_id" TYPE text
USING "scenario_run_id"::text;
--> statement-breakpoint
CREATE UNIQUE INDEX "orders_scenario_run_id_unique_idx"
ON "orders" USING btree ("scenario_run_id")
WHERE "scenario_run_id" IS NOT NULL;
