import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  InsufficientStockError,
  IntegrationNotConfiguredError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from '../errors';
import { newRequestId, toErrorResponse } from './respond';

afterEach(() => vi.restoreAllMocks());

describe('toErrorResponse', () => {
  const cases: Array<[string, Error, number, string]> = [
    ['ValidationError', new ValidationError(), 400, 'VALIDATION_ERROR'],
    ['UnauthenticatedError', new UnauthenticatedError(), 401, 'UNAUTHENTICATED'],
    ['ForbiddenError', new ForbiddenError(), 403, 'FORBIDDEN'],
    ['NotFoundError', new NotFoundError(), 404, 'NOT_FOUND'],
    ['ConflictError', new ConflictError(), 409, 'CONFLICT'],
    ['InsufficientStockError', new InsufficientStockError(), 409, 'INSUFFICIENT_STOCK'],
    ['RateLimitedError', new RateLimitedError(5), 429, 'RATE_LIMITED'],
    ['IntegrationNotConfiguredError', new IntegrationNotConfiguredError('zalo'), 503, 'INTEGRATION_NOT_CONFIGURED'],
  ];

  it.each(cases)('%s -> status and envelope', async (_name, err, status, code) => {
    const res = toErrorResponse(err, 'req-1');
    expect(res.status).toBe(status);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body).toEqual({ error: { code, message: err.message, requestId: 'req-1' } });
  });

  it('includes validation details in the body', async () => {
    const details = [{ path: 'name', message: 'Required' }];
    const body = await toErrorResponse(new ValidationError(details), 'r').json();
    expect(body.error.details).toEqual(details);
  });

  it('sets Retry-After for RateLimitedError', () => {
    const res = toErrorResponse(new RateLimitedError(42), 'r');
    expect(res.headers.get('Retry-After')).toBe('42');
  });

  it('unknown errors become a generic 500 with no message or stack', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = toErrorResponse(new Error('secret sk-123'), 'req-9');
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('secret');
    expect(text).not.toContain('sk-123');
    expect(text).not.toContain('at ');
    const body = JSON.parse(text);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.requestId).toBe('req-9');
    expect(typeof body.error.message).toBe('string');
    // full detail is logged server-side only
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(String(spy.mock.calls[0]![0]));
    expect(logged.requestId).toBe('req-9');
    expect(logged.err.message).toBe('secret sk-123');
  });

  it('handles non-Error throwables', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = toErrorResponse('oops', 'r');
    expect(res.status).toBe(500);
  });
});

describe('newRequestId', () => {
  it('returns unique uuids', () => {
    const a = newRequestId();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(newRequestId()).not.toBe(a);
  });
});
