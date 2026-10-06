import { describe, expect, it } from 'vitest';
import {
  addMoney,
  subtractMoney,
  compareMoney,
  multiplyMoney,
  toMoneyString,
} from '../money';

describe('money helpers', () => {
  it('formats numeric values as two-decimal money strings', () => {
    expect(toMoneyString(10)).toBe('10.00');
    expect(toMoneyString(10.129)).toBe('10.13');
  });

  it('adds and subtracts decimal money strings', () => {
    expect(addMoney('100.00', '25.50')).toBe('125.50');
    expect(subtractMoney('100.00', '25.50')).toBe('74.50');
  });

  it('rejects invalid decimal money strings', () => {
    expect(() => addMoney('', '1.00')).toThrow('Invalid money value');
    expect(() => addMoney(' ', '1.00')).toThrow('Invalid money value');
    expect(() => addMoney('0x10', '1.00')).toThrow('Invalid money value');
    expect(() => addMoney('1e3', '1.00')).toThrow('Invalid money value');
    expect(() => addMoney('1.234', '1.00')).toThrow('Invalid money value');
  });

  it('compares decimal money strings', () => {
    expect(compareMoney('100.00', '99.99')).toBe(1);
    expect(compareMoney('100.00', '100.00')).toBe(0);
    expect(compareMoney('99.99', '100.00')).toBe(-1);
  });

  it('multiplies decimal money by a rate', () => {
    expect(multiplyMoney('100.00', 89.123456)).toBe('8912.35');
  });

  it('rejects non-positive money multipliers', () => {
    expect(() => multiplyMoney('1.00', 0)).toThrow('Invalid money multiplier');
    expect(() => multiplyMoney('1.00', -1)).toThrow('Invalid money multiplier');
  });
});
