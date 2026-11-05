import { AppError, RateLimitedError, ValidationError } from '../errors';
import { logger } from '../logger';

/** Generates a request correlation id. */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Maps any thrown value to the standard error envelope:
 * `{ error: { code, message, requestId, details? } }`.
 * Unknown errors become a generic 500; full detail is logged server-side only.
 */
export function toErrorResponse(err: unknown, requestId: string): Response {
  if (err instanceof AppError) {
    const error: Record<string, unknown> = { code: err.code, message: err.message, requestId };
    if (err instanceof ValidationError && err.details) error.details = err.details;

    const headers: Record<string, string> = {};
    if (err instanceof RateLimitedError) headers['Retry-After'] = String(Math.max(0, Math.ceil(err.retryAfterSec)));

    return Response.json({ error }, { status: err.status, headers });
  }

  logger.error('unhandled_error', { requestId, err });
  return Response.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId } },
    { status: 500 },
  );
}
