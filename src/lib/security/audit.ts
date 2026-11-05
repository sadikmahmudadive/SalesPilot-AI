/**
 * Audit log writer. Server-only.
 *
 * Rows go to `auditLogs` with a server timestamp. `before` / `after` snapshots are passed
 * through the logger's `redact()` so secrets are masked before they reach storage.
 * Rows are never orphaned: every identifying field must be a non-empty string.
 */
import "server-only";
import { FieldValue, type Transaction } from "firebase-admin/firestore";

import { ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { redact } from "@/lib/logger";

export interface AuditEntry {
  organizationId: string;
  actorUid: string;
  action: string;
  resource: string;
  resourceId: string;
  before?: unknown;
  after?: unknown;
}

const COLLECTION = "auditLogs";
const REQUIRED = ["organizationId", "actorUid", "action", "resource", "resourceId"] as const;

function buildAuditDoc(entry: AuditEntry): Record<string, unknown> {
  const invalid = REQUIRED.filter((field) => {
    const value: unknown = entry[field];
    return typeof value !== "string" || value.trim() === "";
  });
  if (invalid.length > 0) {
    throw new ValidationError(
      invalid.map((path) => ({ path, message: "Required for audit entries" })),
      "Invalid audit entry",
    );
  }

  const doc: Record<string, unknown> = {
    organizationId: entry.organizationId,
    actorUid: entry.actorUid,
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId,
    createdAt: FieldValue.serverTimestamp(),
  };
  if (entry.before !== undefined) doc.before = redact(entry.before);
  if (entry.after !== undefined) doc.after = redact(entry.after);
  return doc;
}

/** Writes an audit row and returns its document id. */
export async function writeAudit(entry: AuditEntry): Promise<string> {
  const doc = buildAuditDoc(entry);
  const ref = adminDb().collection(COLLECTION).doc();
  await ref.set(doc);
  return ref.id;
}

/** Adds an audit row to a Firestore transaction so it commits atomically with the change. */
export function writeAuditInTransaction(tx: Transaction, entry: AuditEntry): void {
  const doc = buildAuditDoc(entry);
  tx.set(adminDb().collection(COLLECTION).doc(), doc);
}
