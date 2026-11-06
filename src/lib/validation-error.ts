/**
 * One-field ValidationError. Pure. Messages must be static text: never put caller-supplied
 * values in them (they may be PII). `summary` is the top-level envelope message; it defaults
 * to the generic "Invalid request".
 */
import { ValidationError } from "@/lib/errors";

export function invalid(path: string, message: string, summary?: string): ValidationError {
  return new ValidationError([{ path, message }], summary);
}
