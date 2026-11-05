/**
 * Typed application errors. Dependency-free on purpose (no env / server-only
 * imports) so they can be used from any server code and tested plainly.
 *
 * `name` is set explicitly (not via `new.target.name`) so it survives minification.
 */
/**
 * Brand shared across module copies (Symbol.for) so errors can still be recognised
 * if the bundler ends up with more than one instance of this module.
 */
export const APP_ERROR_BRAND: unique symbol = Symbol.for('salespilot.appError');

export abstract class AppError extends Error {
  readonly [APP_ERROR_BRAND] = true;
  abstract readonly code: string;
  abstract readonly status: number;
}

/** Safe field-level validation info: field path + message, never the input value. */
export interface ValidationDetail {
  path: string;
  message: string;
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR';
  readonly status = 400;
  readonly details?: ReadonlyArray<ValidationDetail>;

  constructor(details?: ReadonlyArray<ValidationDetail>, message = 'Invalid request') {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

export class UnauthenticatedError extends AppError {
  readonly code = 'UNAUTHENTICATED';
  readonly status = 401;

  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'UnauthenticatedError';
  }
}

export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN';
  readonly status = 403;

  constructor(message = 'You do not have permission to perform this action') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND';
  readonly status = 404;

  constructor(message = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  readonly code = 'CONFLICT';
  readonly status = 409;

  constructor(message = 'Request conflicts with the current state of the resource') {
    super(message);
    this.name = 'ConflictError';
  }
}

export class InsufficientStockError extends AppError {
  readonly code = 'INSUFFICIENT_STOCK';
  readonly status = 409;

  constructor(message = 'Insufficient stock') {
    super(message);
    this.name = 'InsufficientStockError';
  }
}

export class RateLimitedError extends AppError {
  readonly code = 'RATE_LIMITED';
  readonly status = 429;

  /** Whole seconds; non-finite or negative input is coerced to 1, fractions round up. */
  readonly retryAfterSec: number;

  constructor(retryAfterSec: number, message = 'Too many requests') {
    super(message);
    this.retryAfterSec = Number.isFinite(retryAfterSec) && retryAfterSec >= 0 ? Math.ceil(retryAfterSec) : 1;
    this.name = 'RateLimitedError';
  }
}

export class IntegrationNotConfiguredError extends AppError {
  readonly code = 'INTEGRATION_NOT_CONFIGURED';
  readonly status = 503;

  constructor(readonly integration: string) {
    super(`Integration not configured: ${integration}`);
    this.name = 'IntegrationNotConfiguredError';
  }
}

/** Structural shape of an AppError, used when instanceof cannot be trusted. */
export interface AppErrorLike {
  code: string;
  status: number;
  message: string;
  details?: unknown;
  retryAfterSec?: unknown;
}

/** True for AppError instances and for branded objects from another copy of this module. */
export function isAppError(err: unknown): err is AppErrorLike {
  if (typeof err !== 'object' || err === null) return false;
  try {
    const e = err as Record<PropertyKey, unknown>;
    return (
      e[APP_ERROR_BRAND] === true &&
      typeof e.code === 'string' &&
      typeof e.status === 'number' &&
      Number.isInteger(e.status) &&
      e.status >= 400 &&
      e.status <= 599
    );
  } catch {
    return false;
  }
}
