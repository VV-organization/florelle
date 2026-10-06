import { AppError } from '../../shared/middleware/error.middleware';

export class EmailAlreadyRegisteredError extends AppError {
  constructor() {
    super(409, 'EMAIL_ALREADY_REGISTERED', 'Email is already registered');
  }
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    super(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
}

export class AccountSuspendedError extends AppError {
  constructor() {
    super(403, 'ACCOUNT_SUSPENDED', 'Account is suspended');
  }
}

export class RegistrationEmailNotVerifiedError extends AppError {
  constructor() {
    super(403, 'REGISTRATION_EMAIL_NOT_VERIFIED', 'Registration email is not verified');
  }
}

export class InvalidRegistrationCodeError extends AppError {
  constructor() {
    super(401, 'INVALID_REGISTRATION_CODE', 'Registration code is invalid or expired');
  }
}

export class InvalidRefreshTokenError extends AppError {
  constructor() {
    super(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
  }
}
