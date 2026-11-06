/**
 * Organization-scoped repository base. Server-only.
 *
 * Every tenant-scoped collection stores `organizationId` on each document, and every
 * operation here takes the organization id first and enforces it:
 *   - reads of another org's document behave exactly like a missing document (null /
 *     NotFoundError), so existence is never revealed;
 *   - writes force `organizationId` (callers can never set or change it);
 *   - `list` ALWAYS adds `where organizationId == orgId` itself. Caller-supplied filters and
 *     cursors can narrow or reposition the query but cannot remove or alter that clause.
 *
 * Stored shape: `{ ...data, organizationId, createdAt, updatedAt }` where the timestamps are
 * Firestore `Timestamp`s (server time). The document id is the Firestore doc id and is NOT
 * stored as a field. Returned documents have `id` set and every `Timestamp` converted to an
 * ISO-8601 string (top level, nested plain objects and arrays; ms precision).
 */
import "server-only";

import {
  FieldPath,
  FieldValue,
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
} from "firebase-admin/firestore";

import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { isValidIdSegment } from "@/lib/ids";
import { decodeCursor, encodeCursor, type Cursor } from "@/lib/pagination";

export type WhereOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "array-contains";
export type WhereClause = [field: string, op: WhereOp, value: unknown];

export interface ListQuery {
  where?: WhereClause[];
  orderBy: [field: string, dir: "asc" | "desc"];
  limit: number;
  cursor?: string;
}

export interface ListResult<T> {
  items: T[];
  nextCursor: string | null;
}

export interface OrgRepositoryOptions {
  /** Fields callers may filter on in `list()`. `organizationId` is never allowed. */
  filterable?: readonly string[];
  /** Fields callers may order by in `list()`. */
  sortable?: readonly string[];
}

/** Fields the repository owns; never accepted from callers' data/patch. */
type Managed = "id" | "organizationId" | "createdAt" | "updatedAt";
export type OrgCreateInput<T> = Omit<T, Managed>;
export type OrgPatch<T> = Partial<Omit<T, Managed>>;

const MANAGED_KEYS: ReadonlySet<string> = new Set<Managed>(["id", "organizationId", "createdAt", "updatedAt"]);
const OPS: ReadonlySet<string> = new Set<WhereOp>(["==", "!=", "<", "<=", ">", ">=", "in", "array-contains"]);
const MAX_LIMIT = 100;
const MAX_IN_VALUES = 30;
const MAX_WHERE_CLAUSES = 10;
const MAX_SERIALIZE_DEPTH = 8;
const GRPC_ALREADY_EXISTS = 6;

function invalid(path: string, message: string): ValidationError {
  // Messages carry field names only, never caller-supplied values.
  return new ValidationError([{ path, message }]);
}

function assertId(value: unknown, path: string): asserts value is string {
  if (!isValidIdSegment(value)) throw invalid(path, "Invalid id");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Recursively converts Timestamps to ISO strings (plain objects and arrays only). */
function serialize(value: unknown, depth = 0): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (depth >= MAX_SERIALIZE_DEPTH) return value;
  if (Array.isArray(value)) return value.map((v) => serialize(v, depth + 1));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v, depth + 1);
    return out;
  }
  return value;
}

/** Full-precision (nanosecond) ISO string, so a timestamp cursor resumes at exactly the right spot. */
function timestampToCursorString(ts: Timestamp): string {
  const base = new Date(ts.seconds * 1000).toISOString().slice(0, 19);
  return `${base}.${String(ts.nanoseconds).padStart(9, "0")}Z`;
}

const CURSOR_TS = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{9})Z$/;

function cursorStringToTimestamp(value: string): Timestamp {
  const match = CURSOR_TS.exec(value);
  const ms = match ? Date.parse(`${match[1]}Z`) : Number.NaN;
  if (!match || Number.isNaN(ms)) throw invalid("cursor", "Cursor is malformed");
  return new Timestamp(ms / 1000, Number(match[2]));
}

function cursorFor(sortValue: unknown, id: string, field: string): Cursor {
  if (sortValue instanceof Timestamp) return { t: "ts", v: timestampToCursorString(sortValue), id };
  if (typeof sortValue === "string") return { t: "s", v: sortValue, id };
  if (typeof sortValue === "number" && Number.isFinite(sortValue)) return { t: "n", v: sortValue, id };
  if (typeof sortValue === "boolean") return { t: "b", v: sortValue, id };
  if (sortValue === null) return { t: "null", v: null, id };
  throw invalid(field, "Field value cannot be used as a sort key");
}

function isScalarFilterValue(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value instanceof Date ||
    value instanceof Timestamp
  );
}

export class OrgRepository<T extends { id: string; organizationId: string }> {
  private readonly filterable: ReadonlySet<string>;
  private readonly sortable: ReadonlySet<string>;

  constructor(
    private readonly collection: string,
    opts: OrgRepositoryOptions = {},
  ) {
    if (typeof collection !== "string" || collection.length === 0 || collection.includes("/")) {
      throw new Error("OrgRepository: collection must be a non-empty top-level collection name");
    }
    if (opts.filterable?.includes("organizationId")) {
      throw new Error("OrgRepository: organizationId can never be filterable (it is always forced)");
    }
    this.filterable = new Set(opts.filterable ?? []);
    this.sortable = new Set(opts.sortable ?? []);
  }

  private db(): Firestore {
    return adminDb();
  }

  private col() {
    return this.db().collection(this.collection);
  }

  /**
   * LOW-LEVEL: a validated reference to a document in this collection. It performs NO
   * organization check; callers (services running their own transactions) must verify
   * `organizationId` themselves, e.g. via `fromSnapshot(snap, orgId)`.
   */
  docRef(id: string): DocumentReference {
    assertId(id, "id");
    return this.col().doc(id);
  }

  /**
   * The reference and exact payload `create()` would write, WITHOUT writing, so a service
   * can `tx.create(ref, data)` atomically with other docs (e.g. lock docs). `organizationId`
   * is forced; `id`/`organizationId`/`createdAt`/`updatedAt` in `data` are ignored.
   */
  build(orgId: string, data: OrgCreateInput<T>, id?: string): { ref: DocumentReference; data: Record<string, unknown> } {
    assertId(orgId, "organizationId");
    if (id !== undefined) assertId(id, "id");
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (!MANAGED_KEYS.has(key) && key !== "__proto__" && value !== undefined) payload[key] = value;
    }
    payload.organizationId = orgId;
    payload.createdAt = FieldValue.serverTimestamp();
    payload.updatedAt = FieldValue.serverTimestamp();
    const ref = id === undefined ? this.col().doc() : this.col().doc(id);
    return { ref, data: payload };
  }

  /**
   * Converts a snapshot to `T` (id set, Timestamps as ISO strings); null when it does not
   * exist. With `orgId`, also null when the doc belongs to another organization. Without
   * it NO organization check is made (low-level; prefer passing `orgId`).
   */
  fromSnapshot(snap: DocumentSnapshot, orgId?: string): T | null {
    if (!snap.exists) return null;
    const data = snap.data();
    if (!data) return null;
    if (orgId !== undefined && data.organizationId !== orgId) return null;
    return { ...(serialize(data) as Record<string, unknown>), id: snap.id } as T;
  }

  async get(orgId: string, id: string): Promise<T | null> {
    assertId(orgId, "organizationId");
    assertId(id, "id");
    // Another org's doc is indistinguishable from a missing one.
    return this.fromSnapshot(await this.col().doc(id).get(), orgId);
  }

  /** Fails with `ConflictError` when `id` already exists (in any org). Returns the stored doc. */
  async create(orgId: string, data: OrgCreateInput<T>, id?: string): Promise<T> {
    const { ref, data: payload } = this.build(orgId, data, id);
    try {
      await ref.create(payload);
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === GRPC_ALREADY_EXISTS) {
        throw new ConflictError("A document with this id already exists");
      }
      throw error;
    }
    const stored = this.fromSnapshot(await ref.get(), orgId);
    if (!stored) throw new NotFoundError();
    return stored;
  }

  /**
   * Transactional patch. `id`/`organizationId`/`createdAt`/`updatedAt` in the patch are
   * ignored; `updatedAt` is set to server time. Keys are literal top-level field names
   * (a key like "a.b" is NOT a nested path). `NotFoundError` if missing or in another org.
   */
  async update(orgId: string, id: string, patch: OrgPatch<T>): Promise<T> {
    assertId(orgId, "organizationId");
    assertId(id, "id");
    const args: unknown[] = [];
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
      if (MANAGED_KEYS.has(key) || key === "__proto__" || value === undefined) continue;
      if (key.length === 0) throw invalid("patch", "Empty field name");
      args.push(new FieldPath(key), value);
    }
    args.push(new FieldPath("updatedAt"), FieldValue.serverTimestamp());

    const ref = this.col().doc(id);
    await this.db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.get("organizationId") !== orgId) throw new NotFoundError();
      tx.update(ref, ...(args as [FieldPath, unknown, ...unknown[]]));
    });
    const stored = this.fromSnapshot(await ref.get(), orgId);
    if (!stored) throw new NotFoundError();
    return stored;
  }

  async remove(orgId: string, id: string): Promise<void> {
    assertId(orgId, "organizationId");
    assertId(id, "id");
    const ref = this.col().doc(id);
    await this.db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.get("organizationId") !== orgId) throw new NotFoundError();
      tx.delete(ref);
    });
  }

  /**
   * Cursor-paginated, org-scoped listing. The query is always
   * `where organizationId == orgId [AND filters] ORDER BY field, __name__` fetched with
   * `limit + 1` to detect a further page.
   *
   * INDEXES: Firestore only auto-creates single-field indexes. In production every
   * combination of (equality/range filter fields..., orderBy field) used with this method,
   * always preceded by `organizationId`, needs a composite index entry in
   * `firestore.indexes.json`. The emulator does not enforce this. Feature tasks that add
   * `list()` call sites (customers, products, orders...) must add their indexes.
   *
   * Cursors are unsigned and untrusted: a forged cursor can only move the start position
   * within the caller's own org-scoped query; the org filter is applied here regardless and
   * is never read from the cursor. Only fields allow-listed via `filterable`/`sortable` may
   * be used, so API query params cannot probe arbitrary fields.
   */
  async list(orgId: string, q: ListQuery): Promise<ListResult<T>> {
    assertId(orgId, "organizationId");
    if (typeof q !== "object" || q === null) throw invalid("query", "Invalid query");

    const { limit } = q;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw invalid("limit", `Limit must be an integer between 1 and ${MAX_LIMIT}`);
    }

    if (!Array.isArray(q.orderBy) || q.orderBy.length !== 2) throw invalid("orderBy", "Invalid sort");
    const [sortField, dir] = q.orderBy;
    if (typeof sortField !== "string" || !this.sortable.has(sortField)) {
      throw invalid("orderBy", `Cannot sort by field: ${String(sortField)}`);
    }
    if (dir !== "asc" && dir !== "desc") throw invalid("orderBy", "Sort direction must be asc or desc");

    let query: Query = this.col().where("organizationId", "==", orgId);

    if (q.where !== undefined) {
      if (!Array.isArray(q.where) || q.where.length > MAX_WHERE_CLAUSES) throw invalid("where", "Invalid filters");
      for (const clause of q.where) {
        if (!Array.isArray(clause) || clause.length !== 3) throw invalid("where", "Invalid filter");
        const [field, op, value] = clause;
        if (typeof field !== "string" || !this.filterable.has(field)) {
          throw invalid("where", `Cannot filter by field: ${String(field)}`);
        }
        if (typeof op !== "string" || !OPS.has(op)) throw invalid(field, "Unsupported filter operator");
        if (op === "in") {
          if (!Array.isArray(value) || value.length === 0 || value.length > MAX_IN_VALUES) {
            throw invalid(field, `"in" requires between 1 and ${MAX_IN_VALUES} values`);
          }
          if (!value.every(isScalarFilterValue)) throw invalid(field, "Unsupported filter value");
        } else if (!isScalarFilterValue(value)) {
          throw invalid(field, "Unsupported filter value");
        }
        query = query.where(field, op as WhereOp, value);
      }
    }

    query = query.orderBy(sortField, dir).orderBy(FieldPath.documentId(), dir);

    if (q.cursor !== undefined) {
      const cursor = decodeCursor(q.cursor);
      const value = cursor.t === "ts" ? cursorStringToTimestamp(cursor.v) : cursor.v;
      query = query.startAfter(value, this.col().doc(cursor.id));
    }

    const snap = await query.limit(limit + 1).get();
    const page = snap.docs.slice(0, limit);
    const items = page.map((doc) => this.fromSnapshot(doc, orgId)).filter((item): item is T => item !== null);

    let nextCursor: string | null = null;
    if (snap.docs.length > limit) {
      const last = page[page.length - 1]!;
      nextCursor = encodeCursor(cursorFor(last.get(sortField), last.id, sortField));
    }
    return { items, nextCursor };
  }
}
