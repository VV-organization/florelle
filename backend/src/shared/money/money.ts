const SCALE = 100;
const MONEY_PATTERN = /^-?\d+(?:\.\d{1,2})?$/;

function toCents(value: string | number): number {
  if (typeof value === 'string' && !MONEY_PATTERN.test(value)) {
    throw new Error('Invalid money value');
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('Invalid money value');
  }
  return Math.round(parsed * SCALE);
}

function fromCents(cents: number): string {
  return (cents / SCALE).toFixed(2);
}

export function toMoneyString(value: string | number): string {
  return fromCents(toCents(value));
}

export function addMoney(left: string, right: string): string {
  return fromCents(toCents(left) + toCents(right));
}

export function subtractMoney(left: string, right: string): string {
  return fromCents(toCents(left) - toCents(right));
}

export function compareMoney(left: string, right: string): -1 | 0 | 1 {
  const diff = toCents(left) - toCents(right);
  if (diff < 0) return -1;
  if (diff > 0) return 1;
  return 0;
}

export function multiplyMoney(amount: string, multiplier: number): string {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new Error('Invalid money multiplier');
  }
  return fromCents(Math.round(toCents(amount) * multiplier));
}
