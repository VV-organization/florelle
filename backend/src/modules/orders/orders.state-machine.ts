/**
 * Order state machine.
 *
 * Allowed transitions:
 *   pending → paid       (webhook on payment success)
 *   pending → cancelled  (webhook on payment failure, or buyer cancel)
 *   paid → shipped       (admin action)
 *   paid → cancelled     (admin refund)
 *   shipped → delivered  (admin action)
 *
 * Terminal states: delivered, cancelled (no outgoing transitions).
 */
export const TRANSITIONS: Record<string, string[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

export function canTransition(from: string, to: string): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
