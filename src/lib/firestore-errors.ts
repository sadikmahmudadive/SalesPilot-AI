/** Firestore error classification. Pure (no firebase imports). */

/** gRPC status code for ALREADY_EXISTS (returned when `create()` hits an existing document). */
export const GRPC_ALREADY_EXISTS = 6;

/** True for a Firestore ALREADY_EXISTS error (numeric gRPC code or the string form). */
export function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === GRPC_ALREADY_EXISTS || code === "already-exists";
}

/** gRPC status code for ABORTED (a transaction lost a race for its documents). */
export const GRPC_ABORTED = 10;

/**
 * True for a Firestore ABORTED error (numeric gRPC code or the string form): transaction
 * contention. Deliberately narrow: UNAVAILABLE, RESOURCE_EXHAUSTED, DEADLINE_EXCEEDED and every
 * other code are outages or quota problems, not contention, and must not be reported as "busy".
 */
export function isContention(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === GRPC_ABORTED || code === "aborted";
}
