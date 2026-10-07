import { setTimeout as delay } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../../shared/db/client";
import { arcPayRateLimits } from "../../shared/db/schema/arc-pay";
import { ArcPayError, type ArcPayRequestGate } from "./arc-pay-client";

/** Budget and 429 cooldown shared by webhook workers, checkout and all backend replicas. */
export class ArcPayRateGate implements ArcPayRequestGate {
  constructor(
    private db: Database,
    private scope: string,
  ) {}
  async acquire() {
    for (;;) {
      const wait = await this.db.transaction(async (tx) => {
        await tx
          .insert(arcPayRateLimits)
          .values({ scope: this.scope })
          .onConflictDoNothing();
        const [gate] = await tx
          .select()
          .from(arcPayRateLimits)
          .where(eq(arcPayRateLimits.scope, this.scope))
          .for("update");
        if (!gate) throw Error("ARC_RATE_GATE_MISSING");
        const now = Date.now();
        if (gate.blockedUntil.getTime() > now)
          throw new ArcPayError(429, gate.blockedUntil.getTime() - now);
        const wait = gate.nextRequestAt.getTime() - now;
        if (wait > 0) return wait;
        // Under Arc's documented default 10 RPS, with headroom for runtime jitter.
        await tx
          .update(arcPayRateLimits)
          .set({ nextRequestAt: new Date(now + 150) })
          .where(eq(arcPayRateLimits.scope, this.scope));
        return 0;
      });
      if (!wait) return;
      await delay(wait);
      // Recheck shared cooldown after waiting; another request may have returned 429.
    }
  }
  async block(delayMs: number) {
    const until = new Date(Date.now() + delayMs);
    await this.db
      .insert(arcPayRateLimits)
      .values({ scope: this.scope, blockedUntil: until })
      .onConflictDoUpdate({
        target: arcPayRateLimits.scope,
        set: {
          blockedUntil: sql`greatest(${arcPayRateLimits.blockedUntil}, ${until.toISOString()}::timestamptz)`,
        },
      });
  }
}
