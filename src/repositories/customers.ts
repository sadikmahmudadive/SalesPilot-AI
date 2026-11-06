/**
 * Customer data access. Server-only.
 *
 *   customers/{customerId}                       the customer (see CustomerDoc)
 *   customerPhones/{organizationId}_{phoneE164}  uniqueness lock { organizationId, customerId, phoneE164, createdAt }
 *
 * The lock document is created in the SAME transaction as the customer, so a phone number is
 * unique per organization without a query. Both collections are denied to clients by the
 * Firestore rules (`customerPhones` falls through to default deny; `customers` is read-only).
 *
 * Lock ids join the organization id and the E.164 number with "_". Organization ids are
 * server-generated (Firestore auto ids / uuids) and the E.164 part always starts with "+",
 * so two different (org, phone) pairs can never produce the same lock id.
 */
import "server-only";

import type { DocumentReference } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { isValidIdSegment } from "@/lib/ids";
import { ValidationError } from "@/lib/errors";
import type { Customer } from "@/schemas/customer";

import { OrgRepository, type OrgCreateInput } from "./base";

/** Stored customer: the public shape plus service-computed keys (name sort/search, case-insensitive tags). */
export type CustomerDoc = Customer & { fullNameLower: string; tagsLower: string[] };

export const CUSTOMERS = "customers";
export const CUSTOMER_PHONES = "customerPhones";

export const customerRepo = new OrgRepository<CustomerDoc>(CUSTOMERS, {
  // Equality / array-contains filters, plus the two fields that carry prefix-search ranges.
  filterable: [
    "segment",
    "customerType",
    "tagsLower",
    "assignedAgentId",
    "fullNameLower",
    "phoneE164",
  ],
  sortable: ["createdAt", "fullNameLower", "lastInteractionAt", "phoneE164"],
});

/** `customerRepo.build` for a payload that holds Firestore sentinels (typed loosely on purpose). */
export function buildCustomer(orgId: string, data: Record<string, unknown>) {
  return customerRepo.build(orgId, data as unknown as OrgCreateInput<CustomerDoc>);
}

/** Reference to the phone lock document of (organization, E.164 number). */
export function phoneLockRef(orgId: string, phoneE164: string): DocumentReference {
  if (
    !isValidIdSegment(orgId) ||
    typeof phoneE164 !== "string" ||
    !/^\+\d{8,15}$/.test(phoneE164)
  ) {
    throw new ValidationError([{ path: "phone", message: "Invalid phone number" }]);
  }
  return adminDb().collection(CUSTOMER_PHONES).doc(`${orgId}_${phoneE164}`);
}

/** Like `phoneLockRef`, but null when the stored number is missing or malformed (corrupt row). */
export function tryPhoneLockRef(orgId: string, phoneE164: unknown): DocumentReference | null {
  if (typeof phoneE164 !== "string" || !/^\+\d{8,15}$/.test(phoneE164)) return null;
  return phoneLockRef(orgId, phoneE164);
}
