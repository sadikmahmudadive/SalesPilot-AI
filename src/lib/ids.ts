/**
 * Firestore document-id validation. Pure (no server-only), shared by the repository
 * base and the cursor decoder.
 *
 * A valid id is a non-empty string of at most 1500 UTF-8 bytes that contains no "/",
 * is not "." or "..", and does not match the reserved `__.*__` pattern.
 */
const MAX_ID_BYTES = 1500;

export function isValidIdSegment(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  // Cheap upper bound first: UTF-8 never needs more than 3 bytes per UTF-16 unit.
  if (value.length > MAX_ID_BYTES) return false;
  if (value.includes("/")) return false;
  if (value === "." || value === "..") return false;
  if (value.length >= 4 && value.startsWith("__") && value.endsWith("__")) return false;
  // TextEncoder is a global in Node and browsers (this module is imported by client-side schemas).
  return new TextEncoder().encode(value).length <= MAX_ID_BYTES;
}
