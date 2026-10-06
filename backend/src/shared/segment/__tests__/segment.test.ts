import { describe, it, expect } from 'vitest';
import {
  mapCustomerTypeToSegment,
  expectedCustomerTypeForSegment,
} from '../segment';

describe('mapCustomerTypeToSegment', () => {
  it('maps legal_entity to b2b', () => {
    expect(mapCustomerTypeToSegment('legal_entity')).toBe('b2b');
  });
  it('maps individual to b2c', () => {
    expect(mapCustomerTypeToSegment('individual')).toBe('b2c');
  });
});

describe('expectedCustomerTypeForSegment', () => {
  it('expects legal_entity for b2b', () => {
    expect(expectedCustomerTypeForSegment('b2b')).toBe('legal_entity');
  });
  it('expects individual for b2c', () => {
    expect(expectedCustomerTypeForSegment('b2c')).toBe('individual');
  });
});
