CREATE UNIQUE INDEX "orders_scenario_run_id_unique_idx"
ON "orders" USING btree ("scenario_run_id")
WHERE "scenario_run_id" IS NOT NULL;
