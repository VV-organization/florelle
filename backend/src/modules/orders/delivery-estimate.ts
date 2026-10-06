export type DeliveryCountryCode = 'RU' | 'KZ' | 'TR';

type DeliveryWeightTierKey = 'light' | 'medium' | 'large' | 'bulk';

type DeliveryTariffConfig = {
  rates: Record<DeliveryWeightTierKey, number>;
  minimums: Record<DeliveryWeightTierKey, number>;
};

export type DeliveryEstimateInput = {
  countryCode: DeliveryCountryCode;
  cityValue: string;
  stemCount: number;
  getRate: (target: string) => Promise<number>;
};

export type DeliveryEstimate = {
  feeUsd: string;
  feeLocal: number;
  localCurrency: 'RUB' | 'KZT' | 'TRY';
  estimatedStems: number;
  estimatedWeightKg: number;
};

const AVERAGE_STEM_WEIGHT_KG = 0.08;
const PACKAGING_WEIGHT_FACTOR = 1.15;

const COUNTRY_CURRENCY: Record<DeliveryCountryCode, DeliveryEstimate['localCurrency']> = {
  RU: 'RUB',
  KZ: 'KZT',
  TR: 'TRY',
};

const TIER_MAX_WEIGHT: Record<DeliveryWeightTierKey, number | null> = {
  light: 20,
  medium: 60,
  large: 100,
  bulk: null,
};

const CITY_TARIFFS: Record<DeliveryCountryCode, Record<string, DeliveryTariffConfig>> = {
  RU: {
    Moscow: tariff([72, 52, 38, 32], [900, 1800, 3200, 5200]),
    'Saint Petersburg': tariff([82, 58, 42, 36], [1200, 2200, 3600, 5600]),
    Novosibirsk: tariff([130, 92, 68, 58], [1800, 3600, 6200, 9000]),
    Yekaterinburg: tariff([112, 78, 56, 48], [1600, 3200, 5200, 7800]),
    Kazan: tariff([92, 64, 46, 40], [1300, 2600, 4200, 6200]),
    'Nizhny Novgorod': tariff([86, 60, 44, 38], [1300, 2400, 4000, 6000]),
    Chelyabinsk: tariff([118, 84, 62, 54], [1700, 3400, 5600, 8400]),
    Krasnoyarsk: tariff([142, 98, 72, 62], [1900, 3900, 6500, 9800]),
    Samara: tariff([94, 66, 48, 42], [1400, 2700, 4400, 6600]),
    Ufa: tariff([104, 74, 54, 46], [1500, 3000, 5000, 7400]),
    'Rostov-on-Don': tariff([102, 72, 52, 44], [1500, 2900, 4800, 7200]),
    Krasnodar: tariff([95, 68, 46, 40], [1400, 2500, 4000, 6000]),
  },
  KZ: {
    Almaty: tariff([1250, 820, 480, 420], [9000, 22000, 42000, 65000]),
    Astana: tariff([1380, 920, 540, 470], [10500, 26000, 48000, 72000]),
    Shymkent: tariff([1460, 980, 580, 500], [11000, 28000, 52000, 78000]),
    Aktobe: tariff([1720, 1160, 690, 610], [13500, 34000, 62000, 93000]),
    Karaganda: tariff([1520, 1020, 600, 520], [11500, 29000, 54000, 81000]),
    Taraz: tariff([1500, 1000, 590, 510], [11200, 28500, 53000, 80000]),
    Oskemen: tariff([1840, 1240, 740, 650], [14500, 36500, 67000, 101000]),
    Pavlodar: tariff([1700, 1140, 680, 590], [13500, 34000, 61500, 92000]),
    Atyrau: tariff([1980, 1340, 800, 700], [15500, 39500, 72000, 108000]),
    Semey: tariff([1820, 1220, 730, 640], [14500, 36000, 66000, 99000]),
    Kostanay: tariff([1740, 1180, 700, 610], [13800, 35000, 63000, 94000]),
    Kyzylorda: tariff([1860, 1260, 750, 660], [14800, 37200, 68000, 102000]),
  },
  TR: {
    Istanbul: tariff([95, 58, 24, 20], [520, 1100, 2100, 3400]),
    Ankara: tariff([120, 74, 32, 28], [680, 1500, 2800, 4300]),
    Izmir: tariff([126, 78, 34, 30], [720, 1600, 3000, 4600]),
    Bursa: tariff([112, 68, 30, 26], [640, 1400, 2600, 4000]),
    Antalya: tariff([148, 92, 42, 36], [860, 1900, 3700, 5600]),
    Konya: tariff([138, 86, 40, 34], [820, 1800, 3500, 5300]),
    Adana: tariff([158, 98, 46, 40], [920, 2050, 4100, 6200]),
    Gaziantep: tariff([168, 104, 50, 44], [980, 2200, 4400, 6600]),
    Sanliurfa: tariff([178, 112, 56, 48], [1060, 2350, 5000, 7300]),
    Kocaeli: tariff([102, 62, 28, 24], [580, 1250, 2400, 3700]),
    Mersin: tariff([154, 96, 46, 40], [900, 2000, 4100, 6100]),
    Diyarbakir: tariff([190, 120, 62, 54], [1150, 2550, 5500, 8000]),
    Kayseri: tariff([144, 90, 42, 36], [840, 1900, 3800, 5700]),
  },
};

function tariff(
  rates: [number, number, number, number],
  minimums: [number, number, number, number],
): DeliveryTariffConfig {
  return {
    rates: {
      light: rates[0],
      medium: rates[1],
      large: rates[2],
      bulk: rates[3],
    },
    minimums: {
      light: minimums[0],
      medium: minimums[1],
      large: minimums[2],
      bulk: minimums[3],
    },
  };
}

export function estimateDeliveryWeightKg(stemCount: number): number {
  if (!Number.isFinite(stemCount) || stemCount <= 0) return 0;
  return Math.max(1, Math.ceil(stemCount * AVERAGE_STEM_WEIGHT_KG * PACKAGING_WEIGHT_FACTOR));
}

function selectTier(weightKg: number): DeliveryWeightTierKey {
  const keys: DeliveryWeightTierKey[] = ['light', 'medium', 'large', 'bulk'];
  return keys.find((key) => {
    const maxWeight = TIER_MAX_WEIGHT[key];
    return maxWeight == null || weightKg <= maxWeight;
  }) ?? 'bulk';
}

function estimateLocalFee(config: DeliveryTariffConfig, weightKg: number): number {
  const tier = selectTier(weightKg);
  return Math.max(config.minimums[tier], Math.ceil(config.rates[tier] * weightKg));
}

export async function estimateB2bDelivery(input: DeliveryEstimateInput): Promise<DeliveryEstimate> {
  const cityTariff = CITY_TARIFFS[input.countryCode]?.[input.cityValue];
  if (!cityTariff) {
    throw new Error(`Unsupported delivery city: ${input.countryCode}/${input.cityValue}`);
  }

  const estimatedStems = Math.max(0, Math.round(input.stemCount));
  const estimatedWeightKg = estimateDeliveryWeightKg(estimatedStems);
  const localCurrency = COUNTRY_CURRENCY[input.countryCode];
  const feeLocal = estimateLocalFee(cityTariff, estimatedWeightKg);
  const rate = await input.getRate(localCurrency);

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Invalid FX rate for ${localCurrency}`);
  }

  return {
    feeUsd: (feeLocal / rate).toFixed(2),
    feeLocal,
    localCurrency,
    estimatedStems,
    estimatedWeightKg,
  };
}
