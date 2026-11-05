import { isAppError } from '../errors';
import { logger } from '../logger';

/** Generates a request correlation id. */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Maps any thrown value to the standard error envelope:
 * `{ error: { code, message, requestId, details? } }`.
 * Unknown errors become a generic 500; full detail is logged server-side only.
 *
 * Our errors are recognised by brand (see `isAppError`) rather than `instanceof`,
 * so this keeps working if the bundler duplicates the errors module.
 */
export function toErrorResponse(err: unknown, requestId: string): Response {
  if (isAppError(err)) {
    const message = typeof err.message === 'string' ? err.message : 'Request failed';
    const error: Record<string, unknown> = { code: err.code, message, requestId };
    if (err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) error.details = err.details;

    const headers: Record<string, string> = {};
    if (err.code === 'RATE_LIMITED') {
      const sec = err.retryAfterSec;
      headers['Retry-After'] = String(typeof sec === 'number' && Number.isFinite(sec) && sec >= 0 ? Math.ceil(sec) : 1);
    }

    return Response.json({ error }, { status: err.status, headers });
  }

  logger.error('unhandled_error', { requestId, err });
  return Response.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId } },
    { status: 500 },
  );
}
