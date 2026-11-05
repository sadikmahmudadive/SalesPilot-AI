import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  InsufficientStockError,
  IntegrationNotConfiguredError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from './errors';

describe('errors', () => {
  const cases: Array<[string, AppError, number, string]> = [
    ['ValidationError', new ValidationError(), 400, 'VALIDATION_ERROR'],
    ['UnauthenticatedError', new UnauthenticatedError(), 401, 'UNAUTHENTICATED'],
    ['ForbiddenError', new ForbiddenError(), 403, 'FORBIDDEN'],
    ['NotFoundError', new NotFoundError(), 404, 'NOT_FOUND'],
    ['ConflictError', new ConflictError(), 409, 'CONFLICT'],
    ['InsufficientStockError', new InsufficientStockError(), 409, 'INSUFFICIENT_STOCK'],
    ['RateLimitedError', new RateLimitedError(30), 429, 'RATE_LIMITED'],
    ['IntegrationNotConfiguredError', new IntegrationNotConfiguredError('zalo'), 503, 'INTEGRATION_NOT_CONFIGURED'],
  ];

  it.each(cases)('%s maps to status and code', (name, err, status, code) => {
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(status);
    expect(err.code).toBe(code);
    expect(err.name).toBe(name);
    expect(err.message.length).toBeGreaterThan(0);
  });

  it('ValidationError carries details', () => {
    const details = [{ path: 'email', message: 'Invalid email' }];
    expect(new ValidationError(details).details).toEqual(details);
    expect(new ValidationError().details).toBeUndefined();
  });

  it('RateLimitedError carries retryAfterSec', () => {
    expect(new RateLimitedError(12).retryAfterSec).toBe(12);
  });

  it('IntegrationNotConfiguredError carries integration name', () => {
    const err = new IntegrationNotConfiguredError('zalo');
    expect(err.integration).toBe('zalo');
    expect(err.message).toContain('zalo');
  });
});
