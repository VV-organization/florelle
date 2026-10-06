import type { Database } from '../db/client';
import type { RedisClient } from '../redis/client';
import { exchangeRates } from '../db/schema/exchange-rates';
import { eq, and, desc } from 'drizzle-orm';
import { AppError } from '../middleware/error.middleware';

export type FxServiceConfig = {
  /** Legacy configuration compatibility; the public endpoint requires no API key. */
  apiKey?: string;
  baseCurrency: string;
  cacheTtlSeconds: number;
  fetchFn?: typeof fetch;
  /** Use only the persisted snapshot; never contact the external provider. */
  offline?: boolean;
  fetchTimeoutMs?: number;
  /** Retail price markup multiplier (e.g. 2.5 means ×2.5 over wholesale USD). */
  markup: number;
};

// Currencies whose rates we proactively cache after a successful fetch.
// open.er-api.com returns every world currency in one response, so warming
// the cache for the supported display currencies costs us nothing extra.
const PREWARM_TARGETS = ['KZT', 'TRY', 'RUB'] as const;

interface OpenErApiResponse {
  result?: 'success' | 'error';
  base_code?: string;
  rates?: Record<string, number>;
}

export class FxService {
  private readonly fetchFn: typeof fetch;
  public readonly markup: number;
  private refreshInFlight?: Promise<Record<string, number>>;

  constructor(
    private readonly db: Database,
    private readonly redis: RedisClient,
    private readonly config: FxServiceConfig,
  ) {
    this.fetchFn = config.fetchFn ?? fetch;
    this.markup = config.markup;
  }

  async getRate(target: string): Promise<number> {
    if (target === this.config.baseCurrency) return 1;

    const cacheKey = this.cacheKeyFor(target);
    if (!this.config.offline) {
      try {
        const cached = await this.redis.get(cacheKey);
        const rate = cached === null ? NaN : Number(cached);
        if (validRate(rate)) return rate;
      } catch {
        // A cache outage must not hide a valid provider or persisted rate.
      }

      try {
        const rates = await this.refreshRates();
        const rate = rates[target];
        if (validRate(rate)) return rate;
      } catch {
        // Provider failure: use the last persisted rate below.
      }
    }

    try {
      const [row] = await this.db.select({ rate: exchangeRates.rate })
        .from(exchangeRates)
        .where(and(eq(exchangeRates.base, this.config.baseCurrency), eq(exchangeRates.target, target)))
        .orderBy(desc(exchangeRates.fetchedAt)).limit(1);
      const rate = row ? Number(row.rate) : NaN;
      if (validRate(rate)) {
        if (!this.config.offline) await this.cacheRate(target, rate);
        return rate;
      }
    } catch {
      // There is no trustworthy conversion rate available.
    }
    throw new AppError(503, 'FX_UNAVAILABLE', `Exchange rate ${this.config.baseCurrency}/${target} is unavailable`);
  }

  private refreshRates(): Promise<Record<string, number>> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.fetchRates().finally(() => { this.refreshInFlight = undefined; });
    }
    return this.refreshInFlight;
  }

  private async fetchRates(): Promise<Record<string, number>> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error('FX_FETCH_TIMEOUT'));
      }, this.config.fetchTimeoutMs ?? 5000);
    });
    try {
      const data = await Promise.race([
        (async () => {
          const response = await this.fetchFn(`https://open.er-api.com/v6/latest/${this.config.baseCurrency}`, { signal: controller.signal });
          if (!response.ok) throw new Error('FX_PROVIDER_UNAVAILABLE');
          return await response.json() as OpenErApiResponse;
        })(),
        deadline,
      ]);
      if (data.result !== 'success' || data.base_code !== this.config.baseCurrency || !data.rates) {
        throw new Error('FX_PROVIDER_INVALID_RESPONSE');
      }
      const rates = Object.fromEntries(Object.entries(data.rates).filter(([, rate]) => validRate(rate)));
      await this.cacheAndPersistRates(rates);
      return rates;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private async cacheRate(target: string, rate: number): Promise<void> {
    try {
      await this.redis.set(this.cacheKeyFor(target), String(rate), 'EX', this.config.cacheTtlSeconds);
    } catch {
      // Persistence and the valid rate remain usable if Redis is unavailable.
    }
  }

  private cacheKeyFor(target: string): string {
    return `fx:${this.config.baseCurrency}:${target}`;
  }

  /**
   * Persist every supported target rate from a successful fetch into both
   * Redis and the database. Failures on individual writes are non-fatal —
   * the next call will simply re-fetch.
   */
  private async cacheAndPersistRates(
    rates: Record<string, number>,
  ): Promise<void> {
    await Promise.all(PREWARM_TARGETS.map(async (target) => {
      const rate = rates[target];
      if (!validRate(rate)) return;
      await Promise.all([this.cacheRate(target, rate), this.upsertRate(target, rate)]);
    }));
  }

  async convert(amountUsd: string, target: string): Promise<string> {
    if (target === this.config.baseCurrency) return amountUsd;
    const rate = await this.getRate(target);
    const amount = parseFloat(amountUsd);
    if (isNaN(amount)) return '0.00';
    return (amount * rate).toFixed(2);
  }

  async convertRetail(amountUsd: string, target: string): Promise<string> {
    const wholesale = parseFloat(amountUsd);
    if (isNaN(wholesale)) return '0.00';
    const retailUsd = (wholesale * this.markup).toFixed(2);
    return this.convert(retailUsd, target);
  }

  private async upsertRate(target: string, rate: number): Promise<void> {
    try {
      await this.db
        .insert(exchangeRates)
        .values({
          base: this.config.baseCurrency,
          target,
          rate: String(rate),
        })
        .onConflictDoUpdate({
          target: [exchangeRates.base, exchangeRates.target],
          set: {
            rate: String(rate),
            fetchedAt: new Date(),
          },
        });
    } catch {
      // Non-critical — log and continue
    }
  }
}

function validRate(rate: unknown): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0;
}
