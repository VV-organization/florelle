import type { CartResponse } from './storefront-types';
import type { Currency } from './catalog';

/** Checkout consumes the server cart; that expected 404 is a normal empty state. */
export async function loadCart(request: () => Promise<CartResponse>, currency: Currency): Promise<CartResponse> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 404 && 'code' in error && error.code === 'CART_NOT_FOUND') {
      return { id: '', currency, expiresAt: new Date().toISOString(), subtotal: '0.00', commission: '0.00', total: '0.00', items: [] };
    }
    throw error;
  }
}
