import { invalid } from "@/lib/validation-error";

/** A consent time may be at most this far ahead of the server clock (client clock skew). */
export const MAX_CONSENT_FUTURE_MS = 5 * 60 * 1000;

/**
 * Normalizes a client-supplied `consent.at` (an ISO-8601 instant with a UTC offset, already checked
 * by the schema) to a UTC instant string, so equal moments always compare and sort equal as text.
 * Rejects instants more than 5 minutes ahead of `nowMs`: consent cannot have been given in the future.
 */
export function normalizeConsentAt(at: string, nowMs: number = Date.now()): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) throw invalid("consent.at", "Enter a valid date and time");
  if (ms > nowMs + MAX_CONSENT_FUTURE_MS)
    throw invalid("consent.at", "Consent date cannot be in the future");
  return new Date(ms).toISOString();
}
