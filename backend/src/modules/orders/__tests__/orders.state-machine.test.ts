import { describe, expect, it } from 'vitest';
import { canTransition } from '../orders.state-machine';

describe('orders state machine', () => {
  describe('canTransition', () => {
    it('allows pending → paid', () => {
      expect(canTransition('pending', 'paid')).toBe(true);
    });

    it('allows pending → cancelled', () => {
      expect(canTransition('pending', 'cancelled')).toBe(true);
    });

    it('allows paid → shipped', () => {
      expect(canTransition('paid', 'shipped')).toBe(true);
    });

    it('allows shipped → delivered', () => {
      expect(canTransition('shipped', 'delivered')).toBe(true);
    });

    it('rejects invalid transitions', () => {
      // Cannot go back
      expect(canTransition('paid', 'pending')).toBe(false);
      // Cannot skip states
      expect(canTransition('pending', 'shipped')).toBe(false);
      expect(canTransition('pending', 'delivered')).toBe(false);
      expect(canTransition('paid', 'delivered')).toBe(false);
      // Terminal states cannot transition
      expect(canTransition('delivered', 'paid')).toBe(false);
      expect(canTransition('delivered', 'cancelled')).toBe(false);
      expect(canTransition('cancelled', 'paid')).toBe(false);
      expect(canTransition('cancelled', 'pending')).toBe(false);
      // Unknown state
      expect(canTransition('unknown', 'paid')).toBe(false);
    });
  });
});
