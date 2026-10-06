import { z } from 'zod';

/**
 * Response shape of `GET /api/v1/currency/rates`.
 *
 * Returns the conversion rates from the platform's base currency (USD) to
 * the supported display currencies. The response also includes USD as the
 * base rate because the frontend keeps price filters and balances in USD
 * internally while showing KZT/TRY/RUB to customers.
 */
export const currencyRatesResponseSchema = z.object({
  base: z.literal('USD'),
  rates: z.object({
    USD: z.number(),
    KZT: z.number(),
    TRY: z.number(),
    RUB: z.number(),
  }),
  fetched_at: z.string(),
});

export type CurrencyRatesResponse = z.infer<typeof currencyRatesResponseSchema>;
