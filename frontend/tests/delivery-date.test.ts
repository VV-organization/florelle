import test from 'node:test';
import assert from 'node:assert/strict';
import { minimumDeliveryDate } from '../src/lib/delivery-date.ts';

test('delivery starts two calendar days later in Moscow, across month and year boundaries', () => {
  for (const [now, expected] of [
    ['2026-11-01T09:00:00Z', '2026-11-03'],
    ['2026-10-31T20:59:59Z', '2026-11-02'],
    ['2026-10-31T21:00:00Z', '2026-11-03'],
    ['2026-12-31T12:00:00Z', '2027-01-02'],
  ]) assert.equal(minimumDeliveryDate(new Date(now)), expected);
});
