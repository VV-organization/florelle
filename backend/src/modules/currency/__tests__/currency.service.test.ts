import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CurrencyService } from '../currency.service';
import type { FxService } from '../../../shared/currency/fx.service';

function createFxMock() {
  return {
    getRate: vi.fn(),
    convert: vi.fn(),
  } as unknown as FxService & {
    getRate: ReturnType<typeof vi.fn>;
    convert: ReturnType<typeof vi.fn>;
  };
}

describe('CurrencyService', () => {
  let fx: ReturnType<typeof createFxMock>;
  let service: CurrencyService;

  beforeEach(() => {
    vi.clearAllMocks();
    fx = createFxMock();
    service = new CurrencyService(fx);
  });

  describe('getRates', () => {
    it('returns USD as base currency with rate 1.0', async () => {
      fx.getRate.mockResolvedValue(0); // not used for USD

      const result = await service.getRates();

      expect(result.base).toBe('USD');
      expect(result.rates.USD).toBe(1);
    });

    it('queries FxService for KZT, TRY and RUB rates and returns them', async () => {
      fx.getRate.mockImplementation((target: string) => {
        if (target === 'KZT') return Promise.resolve(470.5);
        if (target === 'TRY') return Promise.resolve(32.5);
        if (target === 'RUB') return Promise.resolve(95.5);
        return Promise.resolve(1);
      });

      const result = await service.getRates();

      expect(result.rates.KZT).toBe(470.5);
      expect(result.rates.TRY).toBe(32.5);
      expect(result.rates.RUB).toBe(95.5);
      // USD is hard-coded as 1 — no FX call needed.
      expect(fx.getRate).not.toHaveBeenCalledWith('USD');
      expect(fx.getRate).toHaveBeenCalledWith('KZT');
      expect(fx.getRate).toHaveBeenCalledWith('TRY');
      expect(fx.getRate).toHaveBeenCalledWith('RUB');
    });

    it('returns an ISO timestamp in fetched_at', async () => {
      fx.getRate.mockResolvedValue(1);
      const before = Date.now();

      const result = await service.getRates();

      const fetchedAt = Date.parse(result.fetched_at);
      expect(Number.isNaN(fetchedAt)).toBe(false);
      expect(fetchedAt).toBeGreaterThanOrEqual(before);
      expect(fetchedAt).toBeLessThanOrEqual(Date.now());
    });

    it('parallelises KZT, TRY and RUB lookups', async () => {
      // Both calls should be in flight at the same time, not sequential.
      const inflight: string[] = [];
      const finished: string[] = [];
      fx.getRate.mockImplementation(async (target: string) => {
        inflight.push(target);
        await new Promise((r) => setTimeout(r, 5));
        finished.push(target);
        if (target === 'KZT') return 470.5;
        return target === 'TRY' ? 32.5 : 95.5;
      });

      await service.getRates();

      // Both started before either finished → parallel.
      expect(inflight).toEqual(['KZT', 'TRY', 'RUB']);
      // Order of finish is unspecified, but both must complete.
      expect(finished).toHaveLength(3);
    });
  });
});
