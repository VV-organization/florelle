export function paymentHref(order: {
  status: string;
  paymentStatus?: string;
  paymentUrl?: string | null;
}): string | null {
  if (
    order.status !== "pending" ||
    order.paymentStatus === "review" ||
    !order.paymentUrl
  )
    return null;
  try {
    const url = new URL(order.paymentUrl);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
export function paymentRubles(order: {
  paymentAmountMinor?: number;
}): number | null {
  const amount = order.paymentAmountMinor;
  return typeof amount === "number" &&
    Number.isSafeInteger(amount) &&
    amount > 0
    ? amount / 100
    : null;
}

export function formatPaymentRubles(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
