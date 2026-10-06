import type { FxService } from '../../shared/currency/fx.service';
import type { CurrencyRatesResponse } from './currency.schema';

/**
 * Thin orchestration layer over FxService that bundles every supported
 * display currency into a single response. Used by `GET /currency/rates`.
 *
 * Lookups for KZT, TRY and RUB run in parallel to halve the worst-case
 * latency when rates need to be fetched from the upstream provider.
 */
export class CurrencyService {
  constructor(private readonly fxService: FxService) {}

  async getRates(): Promise<CurrencyRatesResponse> {
    const [kzt, tryRate, rub] = await Promise.all([
      this.fxService.getRate('KZT'),
      this.fxService.getRate('TRY'),
      this.fxService.getRate('RUB'),
    ]);

    return {
      base: 'USD',
      rates: {
        USD: 1,
        KZT: kzt,
        TRY: tryRate,
        RUB: rub,
      },
      fetched_at: new Date().toISOString(),
    };
  }
}
