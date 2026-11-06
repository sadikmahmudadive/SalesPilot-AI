/**
 * Customer service: tenant-scoped CRUD, phone uniqueness, audit and search. Server-only.
 *
 * TENANCY. Every function takes `ctx = { organizationId, uid }`, derived by the route wrapper
 * from the verified session + membership document, never from client input. Reads and writes go
 * through `customerRepo` / transactions that compare the stored `organizationId`; a customer in
 * another organization behaves exactly like a missing one (NotFoundError).
 *
 * UNIQUENESS. A phone number is unique per organization through a lock document
 * `customerPhones/{organizationId}_{phoneE164}` that is written in the SAME transaction as the
 * customer (create), moved in the same transaction as the phone change (update) and removed in
 * the same transaction as the customer (delete). The audit row is part of that transaction too,
 * so if the audit write fails nothing (customer, lock) is persisted.
 *   - create uses `tx.create` on the lock and issues no reads, so concurrent creates of one
 *     number do not contend: Firestore rejects all but one commit with ALREADY_EXISTS.
 *   - update/delete read the customer and the locks first (optimistic concurrency).
 *
 * INPUT. Callers pass the Zod-parsed output of `customerInputSchema` / `customerPatchSchema`,
 * but the service still copies only known fields and re-derives `phoneE164` / `whatsappE164`
 * itself, so a smuggled `organizationId`, `totalSpendMinor`, `phoneE164`, ... is never stored.
 *
 * PII. Errors and logs here carry no customer data. Audit rows store before/after snapshots
 * through the shared redactor (phone-like keys are masked to their last 3 digits; name, email
 * and address are stored as entered).
 */
import "server-only";

import { FieldValue, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";

import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { isValidIdSegment } from "@/lib/ids";
import { normalizePhone } from "@/lib/phone";
import { writeAuditInTransaction } from "@/lib/security/audit";
import {
  buildCustomer,
  customerRepo,
  phoneLockRef,
  type CustomerDoc,
} from "@/repositories/customers";
import type { Customer, CustomerInput, CustomerPatch } from "@/schemas/customer";

import { buildListPlan, fullNameLowerKey, type CustomerListQuery } from "./customer-query";

export type { CustomerListQuery } from "./customer-query";

export interface CustomerCtx {
  organizationId: string;
  uid: string;
}

export interface CustomerPage {
  items: Customer[];
  nextCursor: string | null;
}

const GRPC_ALREADY_EXISTS = 6;
const DUPLICATE_PHONE_MESSAGE = "A customer with this phone number already exists";

/** Fields copied from client input (everything else is dropped). */
const INPUT_KEYS = [
  "fullName",
  "phone",
  "whatsappNumber",
  "email",
  "address",
  "customerType",
  "leadSource",
  "tags",
  "segment",
  "preferences",
  "assignedAgentId",
  "consent",
] as const;
/** Fields a PATCH may clear with `null`. Clearing removes the field from the document. */
const CLEARABLE = new Set<string>(["email", "whatsappNumber", "address", "leadSource"]);

type Fields = Record<string, unknown>;

function assertCtx(ctx: CustomerCtx): void {
  // Fail closed: a missing organization must never reach a query.
  if (
    !ctx ||
    !isValidIdSegment(ctx.organizationId) ||
    typeof ctx.uid !== "string" ||
    ctx.uid.trim() === ""
  ) {
    throw new Error("Customer service requires an organization and user context");
  }
}

/** Invalid ids get the same NotFound as missing ones, so ids cannot be probed. */
function assertCustomerId(id: unknown): asserts id is string {
  if (!isValidIdSegment(id)) throw new NotFoundError();
}

function invalid(path: string, message: string): ValidationError {
  return new ValidationError([{ path, message }]);
}

function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === GRPC_ALREADY_EXISTS || code === "already-exists";
}

/** Public shape: the stored document minus the service-internal sort key. */
function toCustomer(doc: CustomerDoc): Customer {
  const copy: Partial<CustomerDoc> = { ...doc };
  delete copy.fullNameLower;
  return copy as Customer;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Fields)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Consent timestamp is stored as an ISO-8601 string (same type the API accepts). */
function normalizeConsent(raw: unknown, existing?: Customer["consent"]): Customer["consent"] {
  const c = (raw ?? { status: "unknown" }) as {
    status: Customer["consent"]["status"];
    at?: string;
    source?: string;
  };
  const out: Customer["consent"] = { status: c.status };
  if (c.source !== undefined) out.source = c.source;
  if (c.at !== undefined) out.at = c.at;
  else if (c.status !== "unknown") {
    // Granted / denied without a time: keep the original time when the status did not change.
    out.at = existing?.status === c.status && existing.at ? existing.at : new Date().toISOString();
  }
  return out;
}

function normalizePreferences(raw: unknown): Fields | undefined {
  if (raw === undefined || raw === null || typeof raw !== "object") return undefined;
  const p = raw as { language?: unknown; notes?: unknown };
  const out: Fields = {};
  if (p.language !== undefined) out.language = p.language;
  if (p.notes !== undefined) out.notes = p.notes;
  return out;
}

function e164Of(raw: unknown, path: string): string {
  const e164 = typeof raw === "string" ? normalizePhone(raw) : null;
  if (!e164) throw invalid(path, "Enter a valid mobile number");
  return e164;
}

/** Plain (JSON-like) field set for a new customer. Nothing here is a Firestore sentinel. */
function createFields(input: CustomerInput): Fields {
  const src = input as unknown as Fields;
  const out: Fields = {};
  for (const key of INPUT_KEYS) {
    if (src[key] !== undefined && src[key] !== null) out[key] = src[key];
  }
  if (typeof out.fullName !== "string" || out.fullName.length === 0)
    throw invalid("fullName", "Enter the customer's name");
  out.phoneE164 = e164Of(out.phone, "phone");
  if (out.whatsappNumber !== undefined)
    out.whatsappE164 = e164Of(out.whatsappNumber, "whatsappNumber");
  out.customerType ??= "retail";
  out.segment ??= "new_lead";
  out.tags ??= [];
  out.consent = normalizeConsent(out.consent);
  const preferences = normalizePreferences(out.preferences);
  if (preferences) out.preferences = preferences;
  else delete out.preferences;
  return out;
}

/** Changed fields for a PATCH; `null` marks a field to clear. Derived E.164 fields are recomputed. */
function patchFields(patch: CustomerPatch, current: CustomerDoc): Fields {
  const src = patch as unknown as Fields;
  const out: Fields = {};
  for (const key of INPUT_KEYS) {
    const value = src[key];
    if (value === undefined) continue;
    if (value === null && !CLEARABLE.has(key)) throw invalid(key, "Invalid value");
    out[key] = value;
  }
  if (out.phone !== undefined) out.phoneE164 = e164Of(out.phone, "phone");
  if (out.whatsappNumber === null) out.whatsappE164 = null;
  else if (out.whatsappNumber !== undefined)
    out.whatsappE164 = e164Of(out.whatsappNumber, "whatsappNumber");
  if (out.consent !== undefined) out.consent = normalizeConsent(out.consent, current.consent);
  if (out.preferences !== undefined) {
    const preferences = normalizePreferences(out.preferences);
    if (preferences) out.preferences = preferences;
    else delete out.preferences;
  }
  if (Object.keys(out).length === 0) throw invalid("body", "At least one field is required");
  return out;
}

function newLockData(organizationId: string, customerId: string, phoneE164: string) {
  return { organizationId, customerId, phoneE164, createdAt: FieldValue.serverTimestamp() };
}

/** True when the lock document exists and belongs to this customer in this organization. */
function ownsLock(snap: DocumentSnapshot, organizationId: string, customerId: string): boolean {
  return (
    snap.exists &&
    snap.get("organizationId") === organizationId &&
    snap.get("customerId") === customerId
  );
}

/** Reads the customer inside the transaction; NotFound when missing or in another organization. */
async function readOwned(tx: Transaction, ctx: CustomerCtx, id: string): Promise<CustomerDoc> {
  const current = customerRepo.fromSnapshot(
    await tx.get(customerRepo.docRef(id)),
    ctx.organizationId,
  );
  if (!current) throw new NotFoundError();
  return current;
}

export async function createCustomer(ctx: CustomerCtx, input: CustomerInput): Promise<Customer> {
  assertCtx(ctx);
  const fields = createFields(input);
  const phoneE164 = fields.phoneE164 as string;
  const fullNameLower = fullNameLowerKey(fields.fullName as string);
  const lockRef = phoneLockRef(ctx.organizationId, phoneE164);

  let id = "";
  try {
    await adminDb().runTransaction(async (tx) => {
      const { ref, data } = buildCustomer(ctx.organizationId, {
        ...fields,
        fullNameLower,
        totalSpendMinor: 0,
        lastInteractionAt: FieldValue.serverTimestamp(), // always set: orderBy drops docs without it
      });
      id = ref.id;
      // Both creates are in one commit: a taken phone (ALREADY_EXISTS on the lock) aborts all.
      tx.create(lockRef, newLockData(ctx.organizationId, ref.id, phoneE164));
      tx.create(ref, data);
      writeAuditInTransaction(tx, {
        organizationId: ctx.organizationId,
        actorUid: ctx.uid,
        action: "customer.create",
        resource: "customer",
        resourceId: ref.id,
        after: fields,
      });
    });
  } catch (err) {
    if (isAlreadyExists(err)) throw new ConflictError(DUPLICATE_PHONE_MESSAGE);
    throw err;
  }
  return getCustomer(ctx, id);
}

export async function getCustomer(ctx: CustomerCtx, id: string): Promise<Customer> {
  assertCtx(ctx);
  assertCustomerId(id);
  const doc = await customerRepo.get(ctx.organizationId, id);
  if (!doc) throw new NotFoundError();
  return toCustomer(doc);
}

export async function updateCustomer(
  ctx: CustomerCtx,
  id: string,
  patch: CustomerPatch,
): Promise<Customer> {
  assertCtx(ctx);
  assertCustomerId(id);

  try {
    await adminDb().runTransaction(async (tx) => {
      const ref = customerRepo.docRef(id);
      const current = await readOwned(tx, ctx, id);
      const next = patchFields(patch, current);

      const newE164 = next.phoneE164 as string | undefined;
      if (newE164 !== undefined && newE164 !== current.phoneE164) {
        const newLock = phoneLockRef(ctx.organizationId, newE164);
        const oldLock = phoneLockRef(ctx.organizationId, current.phoneE164);
        const [newSnap, oldSnap] = await Promise.all([tx.get(newLock), tx.get(oldLock)]);
        if (newSnap.exists && !ownsLock(newSnap, ctx.organizationId, id))
          throw new ConflictError(DUPLICATE_PHONE_MESSAGE);
        if (!newSnap.exists) tx.create(newLock, newLockData(ctx.organizationId, id, newE164));
        if (ownsLock(oldSnap, ctx.organizationId, id)) tx.delete(oldLock);
      }

      const write: Fields = {};
      const before: Fields = {};
      const after: Fields = {};
      for (const [key, value] of Object.entries(next)) {
        write[key] = value === null ? FieldValue.delete() : value;
        const old = (current as unknown as Fields)[key];
        if (stableJson(old ?? null) !== stableJson(value ?? null)) {
          if (old !== undefined) before[key] = old;
          after[key] = value;
        }
      }
      if (typeof next.fullName === "string") write.fullNameLower = fullNameLowerKey(next.fullName);
      write.updatedAt = FieldValue.serverTimestamp();
      tx.update(ref, write);

      writeAuditInTransaction(tx, {
        organizationId: ctx.organizationId,
        actorUid: ctx.uid,
        action: "customer.update",
        resource: "customer",
        resourceId: id,
        before,
        after,
      });
    });
  } catch (err) {
    // Lost a race for the new number between our read and the commit.
    if (isAlreadyExists(err)) throw new ConflictError(DUPLICATE_PHONE_MESSAGE);
    throw err;
  }

  return getCustomer(ctx, id);
}

export async function deleteCustomer(ctx: CustomerCtx, id: string): Promise<void> {
  assertCtx(ctx);
  assertCustomerId(id);

  await adminDb().runTransaction(async (tx) => {
    const ref = customerRepo.docRef(id);
    const current = await readOwned(tx, ctx, id);
    const lock = phoneLockRef(ctx.organizationId, current.phoneE164);
    const lockSnap = await tx.get(lock);

    tx.delete(ref);
    if (ownsLock(lockSnap, ctx.organizationId, id)) tx.delete(lock);

    const snapshot = toCustomer(current) as unknown as Fields;
    writeAuditInTransaction(tx, {
      organizationId: ctx.organizationId,
      actorUid: ctx.uid,
      action: "customer.delete",
      resource: "customer",
      resourceId: id,
      before: snapshot,
    });
  });
}

export async function listCustomers(ctx: CustomerCtx, q: CustomerListQuery): Promise<CustomerPage> {
  assertCtx(ctx);
  const plan = buildListPlan(q);
  const page = await customerRepo.list(ctx.organizationId, {
    where: plan.where,
    orderBy: plan.orderBy,
    limit: plan.limit,
    cursor: plan.cursor,
  });
  return { items: page.items.map(toCustomer), nextCursor: page.nextCursor };
}
