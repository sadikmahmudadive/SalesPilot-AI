/**
 * Helpers for uniqueness lock documents (`customerPhones`, `productSkus`, `productSlugs`, ...).
 * A lock is `{ organizationId, <ownerField>: ownerId, ...extra, createdAt }`, created in the
 * same transaction as the document it protects. Server-only.
 */
import "server-only";

import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";

export function newLockData(
  organizationId: string,
  ownerField: string,
  ownerId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    organizationId,
    [ownerField]: ownerId,
    ...extra,
    createdAt: FieldValue.serverTimestamp(),
  };
}

/** True when the lock document exists and belongs to this owner in this organization. */
export function ownsLock(
  snap: DocumentSnapshot,
  organizationId: string,
  ownerField: string,
  ownerId: string,
): boolean {
  return (
    snap.exists && snap.get("organizationId") === organizationId && snap.get(ownerField) === ownerId
  );
}
