/**
 * Document references for per-workspace WhatsApp numbers. Server-only.
 *
 *   whatsappConnections/{orgId}            one connected number per workspace (sealed token)
 *   whatsappPhoneNumbers/{phoneNumberId}   { organizationId }: the number's single owner, and the
 *                                          webhook's one-read routing lookup
 *
 * Both are server-only (Firestore rules deny all client access).
 */
import "server-only";

import type { DocumentReference } from "firebase-admin/firestore";

import { ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { isValidIdSegment } from "@/lib/ids";

export const WHATSAPP_CONNECTIONS = "whatsappConnections";
export const WHATSAPP_PHONE_NUMBERS = "whatsappPhoneNumbers";

function assertSegment(value: string, path: string): void {
  if (!isValidIdSegment(value)) throw new ValidationError([{ path, message: "Invalid id" }]);
}

export function connectionRef(orgId: string): DocumentReference {
  assertSegment(orgId, "organizationId");
  return adminDb().collection(WHATSAPP_CONNECTIONS).doc(orgId);
}

export function phoneLockRef(phoneNumberId: string): DocumentReference {
  assertSegment(phoneNumberId, "phoneNumberId");
  return adminDb().collection(WHATSAPP_PHONE_NUMBERS).doc(phoneNumberId);
}
