import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { CurrencyService } from './currency.service';
import { currencyRatesResponseSchema } from './currency.schema';

export function buildCurrencyRouter(
  currencyService: CurrencyService,
): FastifyPluginAsync {
  const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.get(
      '/currency/rates',
      {
        schema: {
          tags: ['currency'],
          response: { 200: currencyRatesResponseSchema },
        },
      },
      async () => {
        return currencyService.getRates();
      },
    );
  };

  return plugin;
}
