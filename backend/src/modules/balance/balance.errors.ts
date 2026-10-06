import { AppError } from '../../shared/middleware/error.middleware';

export class TopUpNotFoundError extends AppError {
  constructor() {
    super(404, 'TOP_UP_NOT_FOUND', 'Top-up not found');
  }
}

export class TopUpForbiddenError extends AppError {
  constructor() {
    super(403, 'TOP_UP_FORBIDDEN', 'Top-up belongs to another user');
  }
}

export class InvalidTopUpStatusError extends AppError {
  constructor(message = 'Top-up is not payable') {
    super(400, 'INVALID_TOP_UP_STATUS', message);
  }
}

export class TopUpPaymentCreationFailedError extends AppError {
  constructor() {
    super(502, 'TOP_UP_PAYMENT_CREATION_FAILED', 'Failed to initiate top-up payment');
  }
}
