/**
 * Organization registration. Server-only.
 *
 * Everything happens in ONE Firestore transaction: the `users/{uid}` read, the three creates
 * (user, organization, owner membership) and the audit entry. Either all of them commit or none do.
 *
 * Idempotent per uid: `users/{uid}` is read first. If it already points at an organization, that
 * id is returned and nothing is written. Concurrent calls for the same uid all read the (absent)
 * user doc; Firestore's transaction contention handling aborts and retries the losers, which then
 * re-read and take the "already registered" branch, so exactly one organization is ever created.
 */
import "server-only";
import { FieldValue, type Transaction } from "firebase-admin/firestore";
import { z } from "zod";

import { ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { writeAuditInTransaction, type AuditEntry } from "@/lib/security/audit";
import {
  memberDocId,
  ORGANIZATION_MEMBERS,
  ORGANIZATIONS,
  USERS,
} from "@/repositories/organizations";
import { registerOrganizationSchema } from "@/schemas/organization";

// uid and email come from the verified session; the display fields are validated like the request body.
const inputSchema = registerOrganizationSchema.extend({
  uid: z
    .string()
    .min(1)
    .max(128)
    .refine((v) => !v.includes("/")),
  email: z.string().min(1).max(320),
});

export interface RegisterOrganizationInput {
  uid: string;
  email: string;
  displayName: string;
  organizationName: string;
}

export interface RegisterOrganizationResult {
  organizationId: string;
  /** False when the uid already had an organization and nothing was written. */
  created: boolean;
}

/** Test seam: lets tests make a write inside the transaction fail to prove the rollback. */
export interface RegisterOrganizationDeps {
  writeAudit?: (tx: Transaction, entry: AuditEntry) => void;
}

export async function registerOrganization(
  input: RegisterOrganizationInput,
  deps: RegisterOrganizationDeps = {},
): Promise<RegisterOrganizationResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => ({
        path: i.path.join(".") || "input",
        message: "Invalid value",
      })),
    );
  }
  const { uid, email, displayName, organizationName } = parsed.data;
  const writeAudit = deps.writeAudit ?? writeAuditInTransaction;

  const db = adminDb();
  const userRef = db.collection(USERS).doc(uid);

  return db.runTransaction(async (tx): Promise<RegisterOrganizationResult> => {
    // All reads before any write.
    const userSnap = await tx.get(userRef);
    const existing: unknown = userSnap.exists ? userSnap.get("defaultOrganizationId") : undefined;
    if (typeof existing === "string" && existing.length > 0) {
      return { organizationId: existing, created: false };
    }

    const orgRef = db.collection(ORGANIZATIONS).doc();
    const organizationId = orgRef.id;
    const memberRef = db.collection(ORGANIZATION_MEMBERS).doc(memberDocId(organizationId, uid));
    const now = FieldValue.serverTimestamp();

    tx.set(
      userRef,
      { uid, email, displayName, defaultOrganizationId: organizationId, createdAt: now },
      { merge: true },
    );
    tx.set(orgRef, { name: organizationName, ownerUid: uid, createdAt: now });
    tx.set(memberRef, { organizationId, uid, role: "owner", email, createdAt: now });
    writeAudit(tx, {
      organizationId,
      actorUid: uid,
      action: "organization.create",
      resource: "organization",
      resourceId: organizationId,
      after: { name: organizationName },
    });

    return { organizationId, created: true };
  });
}
