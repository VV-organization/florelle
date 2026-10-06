import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FxService, type FxServiceConfig } from '../fx.service';
import type { Database } from '../../db/client';
import type { RedisClient } from '../../redis/client';

function createDbMock() {
  const db = {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    target: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  return db as unknown as Database & typeof db;
}

function createRedisMock() {
  const redis = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  };
  return redis as unknown as RedisClient & typeof redis;
}

const mockFetch = vi.fn();

const testConfig: FxServiceConfig = {
  apiKey: 'test-api-key',
  baseCurrency: 'USD',
  cacheTtlSeconds: 3600,
  fetchFn: mockFetch,
  markup: 1,
};

describe('FxService', () => {
  let db: ReturnType<typeof createDbMock>;
  let redis: ReturnType<typeof createRedisMock>;
  let service: FxService;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createDbMock();
    redis = createRedisMock();
    service = new FxService(db, redis, testConfig);
  });

  describe('getRate', () => {
    it('returns cached rate from Redis without hitting API or DB', async () => {
      redis.get.mockResolvedValue('32.5');

      const rate = await service.getRate('TRY');

      expect(rate).toBe(32.5);
      expect(redis.get).toHaveBeenCalledWith('fx:USD:TRY');
      expect(mockFetch).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('fetches from open.er-api.com on cache miss, caches in Redis and DB', async () => {
      redis.get.mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          result: 'success',
          base_code: 'USD',
          rates: { USD: 1, KZT: 470.5, TRY: 32.5, RUB: 95 },
        }),
      });

      const rate = await service.getRate('TRY');

      expect(rate).toBe(32.5);
      // Public free endpoint — no API key, single request returns every rate.
      expect(mockFetch).toHaveBeenCalledWith(
        'https://open.er-api.com/v6/latest/USD',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(redis.set).toHaveBeenCalledWith('fx:USD:TRY', '32.5', 'EX', 3600);
      expect(db.insert).toHaveBeenCalled();
    });

    it('caches every known rate from a single fetch (warms KZT and RUB after asking for TRY)', async () => {
      // The provider returns all currencies in one shot, so we should also
      // populate Redis for the other supported targets to skip the second
      // round-trip when the orchestration layer asks for them next.
      redis.get.mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          result: 'success',
          base_code: 'USD',
          rates: { USD: 1, KZT: 470.5, TRY: 32.5, RUB: 95 },
        }),
      });

      await service.getRate('TRY');

      // TRY, KZT and RUB should have been cached.
      const setCalls = redis.set.mock.calls.map((c) => c[0]);
      expect(setCalls).toContain('fx:USD:KZT');
      expect(setCalls).toContain('fx:USD:TRY');
      expect(setCalls).toContain('fx:USD:RUB');
    });

    it('falls back to DB when API returns an error result', async () => {
      redis.get.mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ result: 'error', 'error-type': 'unknown' }),
      });
      db.limit.mockResolvedValue([{ rate: '31.2' }]);

      const rate = await service.getRate('TRY');

      expect(rate).toBe(31.2);
    });

    it('falls back to DB when API fails', async () => {
      redis.get.mockResolvedValue(null);
      mockFetch.mockRejectedValue(new Error('network error'));
      db.limit.mockResolvedValue([{ rate: '31.2' }]);

      const rate = await service.getRate('TRY');

      expect(rate).toBe(31.2);
      expect(redis.set).toHaveBeenCalledWith('fx:USD:TRY', '31.2', 'EX', 3600);
    });

    it('reports FX_UNAVAILABLE when Redis, API, and DB all fail', async () => {
      redis.get.mockResolvedValue(null);
      mockFetch.mockRejectedValue(new Error('network error'));
      db.limit.mockResolvedValue([]);

      await expect(service.getRate('TRY')).rejects.toMatchObject({ code: 'FX_UNAVAILABLE', statusCode: 503 });
    });
  });

  describe('reliable refresh', () => {
    it.each(['0', '-2', 'Infinity', 'NaN', '12junk'])('rejects invalid cached and persisted rate %s', async (rate) => {
      redis.get.mockResolvedValue(rate); db.limit.mockResolvedValue([{ rate }]);
      mockFetch.mockRejectedValue(new Error('offline'));
      await expect(service.getRate('RUB')).rejects.toMatchObject({ code: 'FX_UNAVAILABLE' });
    });
    it.each([0, -2, Infinity, NaN])('does not use invalid external rate %s', async (rate) => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ result: 'success', base_code: 'USD', rates: { RUB: rate } }) });
      await expect(service.getRate('RUB')).rejects.toMatchObject({ code: 'FX_UNAVAILABLE' });
      expect(db.insert).not.toHaveBeenCalled();
    });
    it('rejects external rates with the wrong base currency', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ result: 'success', base_code: 'EUR', rates: { RUB: 90 } }) });
      await expect(service.getRate('RUB')).rejects.toMatchObject({ code: 'FX_UNAVAILABLE' });
    });
    it('uses valid external rates even when Redis is down', async () => {
      redis.get.mockRejectedValue(new Error('Redis offline')); redis.set.mockRejectedValue(new Error('Redis offline'));
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ result: 'success', base_code: 'USD', rates: { RUB: 90 } }) });
      expect(await service.getRate('RUB')).toBe(90);
    });
    it('loads only the DB snapshot in offline mode, ignoring stale Redis values', async () => {
      const offline = new FxService(db, redis, { ...testConfig, offline: true });
      redis.get.mockResolvedValue('999'); db.limit.mockResolvedValue([{ rate: '80.25' }]);
      expect(await offline.getRate('RUB')).toBe(80.25);
      expect(mockFetch).not.toHaveBeenCalled(); expect(redis.get).not.toHaveBeenCalled();
    });
    it('coalesces simultaneous misses across target currencies into one provider fetch', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ result: 'success', base_code: 'USD', rates: { RUB: 90, TRY: 32 } }) });
      expect(await Promise.all([service.getRate('RUB'), service.getRate('TRY'), service.getRate('RUB')])).toEqual([90, 32, 90]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    it('bounds stalled fetches and falls back to persisted rates', async () => {
      vi.useFakeTimers();
      try {
        mockFetch.mockImplementation(() => new Promise(() => {})); db.limit.mockResolvedValue([{ rate: '80' }]);
        const bounded = new FxService(db, redis, { ...testConfig, fetchTimeoutMs: 100 });
        const result = bounded.getRate('RUB');
        await vi.advanceTimersByTimeAsync(101);
        expect(await result).toBe(80);
        expect(mockFetch.mock.calls[0]![1].signal.aborted).toBe(true);
      } finally { vi.useRealTimers(); }
    });
  });

  describe('convert', () => {
    it('returns amountUsd as-is when target is USD', async () => {
      const result = await service.convert('12.50', 'USD');

      expect(result).toBe('12.50');
      expect(redis.get).not.toHaveBeenCalled();
    });

    it('converts amount using fetched rate', async () => {
      redis.get.mockResolvedValue('32.5');

      const result = await service.convert('12.50', 'TRY');

      expect(result).toBe('406.25');
    });
  });
});

function makeFx(markup: number, convertReturns: string) {
  const db = {} as any;
  const redis = {} as any;
  const config: FxServiceConfig = {
    baseCurrency: 'USD',
    cacheTtlSeconds: 3600,
    markup,
  };
  const fx = new FxService(db, redis, config);
  vi.spyOn(fx, 'convert').mockResolvedValue(convertReturns);
  return fx;
}

describe('FxService.convertRetail', () => {
  it('multiplies the amount by markup before calling convert', async () => {
    const fx = makeFx(2, '20.00');
    const result = await fx.convertRetail('5.00', 'USD');
    expect(fx.convert).toHaveBeenCalledWith('10.00', 'USD');
    expect(result).toBe('20.00');
  });

  it('passes through markup=1 (B2B path) unchanged', async () => {
    const fx = makeFx(1, '5.00');
    const result = await fx.convertRetail('5.00', 'USD');
    expect(fx.convert).toHaveBeenCalledWith('5.00', 'USD');
    expect(result).toBe('5.00');
  });

  it('returns 0.00 for non-numeric input without calling convert', async () => {
    const fx = makeFx(2.5, '0.00');
    const result = await fx.convertRetail('abc', 'TRY');
    expect(fx.convert).not.toHaveBeenCalled();
    expect(result).toBe('0.00');
  });

  it('exposes markup as a public readonly field', () => {
    const fx = makeFx(2.5, '0.00');
    expect(fx.markup).toBe(2.5);
  });
});
