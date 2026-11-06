/** Firestore error classification. Pure (no firebase imports). */

/** gRPC status code for ALREADY_EXISTS (returned when `create()` hits an existing document). */
export const GRPC_ALREADY_EXISTS = 6;

/** True for a Firestore ALREADY_EXISTS error (numeric gRPC code or the string form). */
export function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === GRPC_ALREADY_EXISTS || code === "already-exists";
}
