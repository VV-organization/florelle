import { AppError } from '../../shared/middleware/error.middleware';

export class CartNotFoundError extends AppError {
  constructor() {
    super(404, 'CART_NOT_FOUND', 'Cart not found');
  }
}

export class CartExpiredError extends AppError {
  constructor() {
    super(404, 'CART_EXPIRED', 'Cart has expired');
  }
}

export class EmptyCartError extends AppError {
  constructor() {
    super(400, 'EMPTY_CART', 'Cannot create order from empty cart');
  }
}

export class ItemAlreadyInCartError extends AppError {
  constructor() {
    super(409, 'ITEM_ALREADY_IN_CART', 'This listing is already in your cart');
  }
}

export class CartItemNotFoundError extends AppError {
  constructor() {
    super(404, 'CART_ITEM_NOT_FOUND', 'Cart item not found');
  }
}

export class CheckoutInProgressError extends AppError {
  constructor() {
    super(409, 'CHECKOUT_IN_PROGRESS', 'Checkout is already in progress');
  }
}

export class CheckoutClaimInvariantError extends AppError {
  constructor(merchantOrderId: string | null, reason: string) {
    super(
      500,
      'CHECKOUT_CLAIM_INVARIANT',
      'Checkout claim state is inconsistent',
      { merchantOrderId, reason },
    );
  }
}

export class ListingUnavailableError extends AppError {
  constructor(listingId: string) {
    super(409, 'LISTING_UNAVAILABLE', 'Listing is no longer available', {
      listingId,
    });
  }
}

export class InsufficientStemsError extends AppError {
  constructor(listingId: string, available: number, requested: number) {
    super(409, 'INSUFFICIENT_STEMS', 'Insufficient stems for listing', {
      listingId,
      available,
      requested,
    });
  }
}

export class SegmentMismatchError extends AppError {
  constructor() {
    super(403, 'SEGMENT_MISMATCH', 'This action is not allowed for your account type');
  }
}

export class InvalidDeliverySelectionError extends AppError {
  constructor(countryCode?: string, cityValue?: string) {
    super(400, 'INVALID_DELIVERY_SELECTION', 'Unsupported delivery destination', {
      countryCode,
      cityValue,
    });
  }
}

export class OrderNotFoundError extends AppError {
  constructor() {
    super(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
}

export class PaymentCreationFailedError extends AppError {
  constructor() {
    super(502, 'PAYMENT_CREATION_FAILED', 'Failed to initiate order payment');
  }
}

export class OrderCompensationInvariantError extends AppError {
  constructor(listingId: string) {
    super(
      500,
      'ORDER_COMPENSATION_INVARIANT',
      'Failed to restore reserved order stock',
      { listingId },
    );
  }
}

export class InvalidOrderTransitionError extends AppError {
  constructor(from: string, to: string) {
    super(409, 'INVALID_ORDER_TRANSITION', 'Invalid order status transition', {
      from,
      to,
    });
  }
}
