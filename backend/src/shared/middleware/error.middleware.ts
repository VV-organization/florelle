import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/**
 * Shape of every error response body.
 */
export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Typed application error. Services throw subclasses; the global error
 * handler turns them into JSON responses.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', details?: unknown) {
    super(404, 'NOT_FOUND', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', details?: unknown) {
    super(401, 'UNAUTHORIZED', message, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', details?: unknown) {
    super(403, 'FORBIDDEN', message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) {
    super(409, 'CONFLICT', message, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(422, 'VALIDATION_ERROR', message, details);
  }
}

/**
 * Fastify global error handler. Never catches errors elsewhere — throw
 * typed AppError subclasses from services and let them bubble up here.
 */
export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof AppError) {
    const body: ErrorResponseBody = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    };
    reply.status(error.statusCode).send(body);
    return;
  }

  if (error instanceof ZodError) {
    const body: ErrorResponseBody = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.flatten(),
      },
    };
    reply.status(422).send(body);
    return;
  }

  if (error.validation) {
    const body: ErrorResponseBody = {
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: error.validation,
      },
    };
    reply.status(400).send(body);
    return;
  }

  request.log.error({ err: error }, 'unhandled error');
  const body: ErrorResponseBody = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  };
  reply.status(500).send(body);
}
