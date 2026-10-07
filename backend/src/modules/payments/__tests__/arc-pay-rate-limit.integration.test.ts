import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../../../shared/db/schema";
import { ArcPayClient } from "../arc-pay-client";
import { ArcPayRateGate } from "../arc-pay-rate-gate";
const databaseUrl = process.env.TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)("shared Arc tenant rate gate", () => {
  it("shares Retry-After across independent clients and backend workers", async () => {
    const sql = postgres(databaseUrl!),
      db = drizzle(sql, { schema }),
      scope = randomUUID();
    let requests = 0;
    const fetchFn: typeof fetch = async () => {
      requests++;
      return Response.json(
        {},
        { status: 429, headers: { "Retry-After": "60" } },
      );
    };
    try {
      const first = new ArcPayClient({
        secretKey: "sk_test_local",
        fetchFn,
        rateGate: new ArcPayRateGate(db, scope),
      });
      const second = new ArcPayClient({
        secretKey: "sk_test_local",
        fetchFn,
        rateGate: new ArcPayRateGate(db, scope),
      });
      await expect(first.getPayment("first")).rejects.toMatchObject({
        status: 429,
      });
      await expect(second.getPayment("second")).rejects.toMatchObject({
        status: 429,
      });
      await expect(second.assertAvailable()).rejects.toMatchObject({
        status: 429,
      });
      expect(requests).toBe(1);
    } finally {
      await db
        .delete(schema.arcPayRateLimits)
        .where(eq(schema.arcPayRateLimits.scope, scope));
      await sql.end();
    }
  });
});
