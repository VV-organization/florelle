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
    return url.origin === "https://payment.paidlayer.com" && !url.username && !url.password && !url.search && !url.hash && /^\/[a-zA-Z0-9_-]{1,128}$/.test(url.pathname)
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

export function hostedPaymentForm(order: {id: string; status: string; paymentStatus?: string; paymentUrl?: string | null}, origin: string) {
  const action = paymentHref(order);
  const base = new URL(origin);
  if (!action || !order.id || !['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('Некорректная ссылка на оплату');
  const returnUrl = new URL('/orders/' + encodeURIComponent(order.id), base.origin).toString();
  return { action, method: 'POST', fields: { successUrl: returnUrl, failUrl: returnUrl } };
}

export function submitHostedPayment(order: Parameters<typeof hostedPaymentForm>[0]) {
  const checkout = hostedPaymentForm(order, window.location.origin);
  const form = document.createElement('form');
  form.method = checkout.method;
  form.action = checkout.action;
  for (const [name, value] of Object.entries(checkout.fields)) {
    const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}
