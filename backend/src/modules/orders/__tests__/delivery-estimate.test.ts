import { describe, expect, it, vi } from 'vitest';
import {
  estimateB2bDelivery,
  estimateDeliveryWeightKg,
} from '../delivery-estimate';

describe('delivery estimate', () => {
  it('estimates packed flower weight from stem count', () => {
    expect(estimateDeliveryWeightKg(75)).toBe(7);
    expect(estimateDeliveryWeightKg(0)).toBe(0);
  });

  it('calculates B2B delivery from country, city and estimated weight', async () => {
    const getRate = vi.fn().mockResolvedValue(100);

    const estimate = await estimateB2bDelivery({
      countryCode: 'RU',
      cityValue: 'Moscow',
      stemCount: 75,
      getRate,
    });

    expect(estimate).toMatchObject({
      estimatedStems: 75,
      estimatedWeightKg: 7,
      feeLocal: 900,
      localCurrency: 'RUB',
      feeUsd: '9.00',
    });
    expect(getRate).toHaveBeenCalledWith('RUB');
  });
});
