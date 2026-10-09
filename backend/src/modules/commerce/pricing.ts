import { AppError } from "../../shared/middleware/error.middleware";
export type DeliveryCountry = {
  code: string;
  cities: { value: string; rates: number[]; minimums: number[] }[];
};
export type CheckoutInput = {
  segment: "b2b" | "b2c";
  displayCurrency?: "RUB" | "KZT" | "TRY";
  shippingAddress: {
    address: string;
    contactName: string;
    contactPhone: string;
  };
  delivery?: {
    countryCode: "RU" | "KZ" | "TR";
    cityValue: string;
    mode?: number;
    date?: string;
    window?: string;
  };
  notes?: string;
};
export type PriceLine = {
  listingId: string;
  quantity: number;
  boxQuantity: number;
  availableStems: number;
  priceCurrency?: string | null;
  wholesalePrice?: string | null;
  retailPrice?: string | null;
  referencePrice?: string | null;
  sellerPriceUsd: string;
};
export const retailDefaults: Record<string, number[]> = {
  RU: [350, 700, 500, 10000],
  KZ: [2500, 4500, 3500, 25000],
  TR: [100, 150, 120, 2500],
};
export const localCurrency: Record<string, string> = {
  RU: "RUB",
  KZ: "KZT",
  TR: "TRY",
};
export function money(cents: number) {
  return (cents / 100).toFixed(2);
}
export function convertMinor(
  amount: string | number,
  from: string,
  to: string,
  rates: Record<string, number>,
  quantity = 1,
): number {
  for (const c of [from, to])
    if (!Number.isFinite(rates[c]) || rates[c]! <= 0)
      throw new AppError(503, "FX_UNAVAILABLE", `Missing valid rate for ${c}`);
  if (
    !/^\d+(\.\d+)?$/.test(String(amount)) ||
    !Number.isSafeInteger(quantity) ||
    quantity < 0
  )
    throw new AppError(400, "INVALID_PRICE", "Invalid price or quantity");
  const scale = 1000000000n;
  const fixed = (n: string | number) => {
    const [a, b = ""] = String(n).split(".");
    return BigInt(a!) * scale + BigInt(b.padEnd(9, "0").slice(0, 9));
  };
  const numerator = fixed(amount) * fixed(rates[to]!) * 100n * BigInt(quantity),
    denominator = scale * fixed(rates[from]!);
  const result = Number((numerator + denominator / 2n) / denominator);
  if (!Number.isSafeInteger(result))
    throw new AppError(400, "INVALID_PRICE", "Price overflow");
  return result;
}
export function minimumDeliveryDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" })
    .format(new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000));
}

export function validateDelivery(
  input: CheckoutInput,
  countries: DeliveryCountry[],
  now = new Date(),
) {
  const d = input.delivery,
    city = countries
      .find((c) => c.code === d?.countryCode)
      ?.cities.find((c) => c.value === d?.cityValue);
  if (!d || !city)
    throw new AppError(
      400,
      "INVALID_DELIVERY_SELECTION",
      "Выберите город доставки",
    );
  const digits = input.shippingAddress.contactPhone.replace(/\D/g, "");
  const pattern =
    d.countryCode === "TR"
      ? /^90\d{10}$/
      : d.countryCode === "KZ"
        ? /^7\d{10}$/
        : /^[78]\d{10}$/;
  if (!pattern.test(digits))
    throw new AppError(400, "INVALID_PHONE", "Проверьте телефон получателя");
  if (d.date) {
    const day = new Date(d.date + "T00:00:00Z");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(d.date) ||
      !Number.isFinite(day.getTime()) ||
      day.toISOString().slice(0, 10) !== d.date ||
      d.date < minimumDeliveryDate(now)
    )
      throw new AppError(
        400,
        "INVALID_DELIVERY_DATE",
        "Выберите дату доставки не раньше чем через два дня",
      );
  }
  if (
    d.window &&
    !["09:00–13:00", "13:00–18:00", "18:00–21:00"].includes(d.window)
  )
    throw new AppError(
      400,
      "INVALID_DELIVERY_WINDOW",
      "Выберите интервал доставки",
    );
  if (!Number.isInteger(d.mode ?? 0) || (d.mode ?? 0) < 0 || (d.mode ?? 0) > 2)
    throw new AppError(
      400,
      "INVALID_DELIVERY_MODE",
      "Выберите способ доставки",
    );
  return city;
}
export function calculateQuote(
  lines: PriceLine[],
  input: CheckoutInput,
  rates: Record<string, number>,
  countries: DeliveryCountry[],
  commissionPercent: number,
  markup: number,
  retailRates = retailDefaults,
) {
  const city = validateDelivery(input, countries),
    currency = input.displayCurrency ?? "RUB";
  // Settlement is always computed in RUB; display rounding cannot change the charge.
  const display = (minor: number) =>
    money(convertMinor(money(minor), "RUB", currency, rates));
  if (!lines.length) throw new AppError(400, "EMPTY_CART", "Корзина пуста");
  let subtotalMinor = 0,
    stems = 0;
  const items = lines.map((l) => {
    if (
      !Number.isSafeInteger(l.quantity) ||
      l.quantity < 1 ||
      !Number.isSafeInteger(l.boxQuantity) ||
      l.boxQuantity < 1
    )
      throw new AppError(400, "INVALID_QUANTITY", "Проверьте количество");
    const units = input.segment === "b2b" ? l.boxQuantity : 1,
      reservedStems = units * l.quantity;
    if (reservedStems > l.availableStems)
      throw new AppError(409, "INSUFFICIENT_STEMS", "Insufficient stock");
    const imported = l.wholesalePrice != null && l.priceCurrency;
    const source = imported ? l.priceCurrency! : "USD";
    const raw =
      input.segment === "b2b"
        ? (l.wholesalePrice ?? l.sellerPriceUsd)
        : (l.retailPrice ??
          String(Number(l.wholesalePrice ?? l.sellerPriceUsd) * markup));
    const unitMinor = convertMinor(raw, source, "RUB", rates, units),
      lineMinor = unitMinor * l.quantity;
    subtotalMinor += lineMinor;
    stems += reservedStems;
    return {
      listingId: l.listingId,
      quantity: l.quantity,
      reservedStems,
      segment: input.segment,
      price: display(unitMinor),
      lineTotal: display(lineMinor),
      unitPriceUsd: money(convertMinor(money(unitMinor), "RUB", "USD", rates)),
      totalPriceUsd: money(convertMinor(money(lineMinor), "RUB", "USD", rates)),
    };
  });
  const commissionMinor = Math.round((subtotalMinor * commissionPercent) / 100),
    weight = Math.max(1, Math.ceil(stems * 0.08 * 1.15));
  const local = localCurrency[input.delivery!.countryCode]!,
    mode = input.delivery!.mode ?? 0;
  let fee: number;
  if (input.segment === "b2b") {
    const tier = weight <= 20 ? 0 : weight <= 60 ? 1 : weight <= 100 ? 2 : 3;
    fee = Math.max(city.minimums[tier]!, Math.ceil(city.rates[tier]! * weight));
  } else {
    const tariffs = retailRates[input.delivery!.countryCode]!;
    const localSubtotal = convertMinor(
      money(subtotalMinor),
      "RUB",
      local,
      rates,
    );
    fee = localSubtotal >= tariffs[3]! * 100 && mode !== 1 ? 0 : tariffs[mode]!;
  }
  const shippingMinor = convertMinor(fee, local, "RUB", rates),
    totalMinor = subtotalMinor + commissionMinor + shippingMinor;
  const rubBeforeDelivery = convertMinor(
      money(subtotalMinor + commissionMinor),
      "RUB",
      "RUB",
      rates,
    ),
    missingRub =
      Math.max(0, (input.segment === "b2b" ? 500000 : 300000) - rubBeforeDelivery);
  return {
    subtotal: display(subtotalMinor),
    commission: display(commissionMinor),
    shipping: display(shippingMinor),
    total: display(totalMinor),
    currency,
    estimatedWeightKg: weight,
    estimatedStems: stems,
    minimumMissingRub: money(missingRub),
    minimumMissing: money(
      convertMinor(money(missingRub), "RUB", currency, rates),
    ),
    paymentAmountMinor: totalMinor,
    items,
    subtotalUsd: money(convertMinor(money(subtotalMinor), "RUB", "USD", rates)),
    commissionUsd: money(
      convertMinor(money(commissionMinor), "RUB", "USD", rates),
    ),
    deliveryFeeUsd: money(
      convertMinor(money(shippingMinor), "RUB", "USD", rates),
    ),
    totalUsd: money(convertMinor(money(totalMinor), "RUB", "USD", rates)),
  };
}
