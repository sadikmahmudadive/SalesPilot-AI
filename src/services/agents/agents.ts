/**
 * Agent service: tenant-scoped create / read / update / list of AI agents with config
 * versioning and audit. Server-only.
 *
 * TENANCY. Every function takes `ctx = { organizationId, uid }`, derived by the route wrapper from
 * the verified session + membership document, never from client input. Reads and writes go
 * through `agentRepo` / transactions that compare the stored `organizationId`; an agent in
 * another organization behaves exactly like a missing one (NotFoundError). Category ids in
 * `productAccess` must resolve to categories of the SAME organization (ValidationError
 * otherwise); they are checked inside the write transaction.
 *
 * VERSIONING. `version` starts at 1 and is bumped by an update iff at least one of
 * `VERSIONED_FIELDS` (behaviour: personality, instructions, objectives, languages, tools,
 * productAccess, escalation, limits, responseStyle, model) holds a value different from the stored
 * one, compared deeply with `stableJson` (array order matters; an absent `model` equals a cleared
 * one). Name, description, role, channels and status never bump it. Clients can never send
 * `version`, `createdBy` or `organizationId`: only known fields are copied.
 *
 * PATCH SEMANTICS. Nested objects (`limits`, `escalation`, `productAccess`) are written as WHOLE
 * replacements (`tx.update` with the full object), so a key omitted from the patch (e.g. a cleared
 * `escalation.maxTurnsBeforeHandover`) is removed from the stored document. `model: null` removes
 * the field. A patch that changes nothing is a no-op: no write, no audit row, `updatedAt`
 * untouched (the list is ordered by `updatedAt`, so a no-op must not reorder it).
 *
 * AUDIT. Rows are written in the same transaction as the change (a failing audit write persists
 * nothing) and never hold instructions, personality or other free text:
 *   - `agent.create`:     after { name, role, status, version }
 *   - `agent.update`:     after { changedFields (names), version }
 *   - `agent.activate` / `agent.deactivate`: before { status }, after { status, version }.
 * A status-only patch writes only the activate/deactivate row. A patch that changes status AND
 * other fields writes BOTH `agent.update` (its changedFields include "status") and the
 * activate/deactivate row.
 */
import "server-only";

import { FieldValue, type Transaction } from "firebase-admin/firestore";

import { NotFoundError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { DEFAULT_LIMIT, MAX_LIMIT, resolveListLimit } from "@/lib/list-params";
import { assertEntityId, assertOrgCtx } from "@/lib/org-context";
import { writeAuditInTransaction } from "@/lib/security/audit";
import { stableJson } from "@/lib/stable-json";
import { sortKey } from "@/lib/text";
import { invalid } from "@/lib/validation-error";
import { agentRepo, buildAgent, type AgentDoc } from "@/repositories/agents";
import { categoryRepo } from "@/repositories/categories";
import { VERSIONED_FIELDS, type Agent, type AgentInput, type AgentPatch } from "@/schemas/agent";

export interface AgentCtx {
  organizationId: string;
  uid: string;
}

export interface AgentPage {
  items: Agent[];
  nextCursor: string | null;
}

export interface AgentListQuery {
  limit?: number;
  cursor?: string;
}

type Fields = Record<string, unknown>;

/** Fields copied from client input (everything else is dropped). */
const INPUT_KEYS = [
  "name",
  "role",
  "status",
  "description",
  "personality",
  "instructions",
  "objectives",
  "languages",
  "tools",
  "productAccess",
  "channels",
  "escalation",
  "limits",
  "responseStyle",
  "model",
] as const;

export function assertCtx(ctx: AgentCtx): void {
  assertOrgCtx(ctx, "Agent");
}

/** Public shape: the stored document minus the service-internal sort key. */
function toAgent(doc: AgentDoc): Agent {
  const copy: Partial<AgentDoc> = { ...doc };
  delete copy.nameLower;
  return copy as Agent;
}

function pick(source: unknown): Fields {
  const src = source as Fields;
  const out: Fields = {};
  for (const key of INPUT_KEYS) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  return out;
}

/** Category ids a `productAccess` value refers to (none for mode "all"). */
function categoryIdsOf(productAccess: unknown): string[] {
  const pa = productAccess as { mode?: unknown; categoryIds?: unknown } | undefined;
  if (pa?.mode === "categories" && Array.isArray(pa.categoryIds)) {
    return pa.categoryIds.filter((id): id is string => typeof id === "string");
  }
  return [];
}

/** Every category must exist in the caller's organization (reads only; call before any write). */
async function assertCategories(tx: Transaction, orgId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const snaps = await Promise.all(ids.map((id) => tx.get(categoryRepo.docRef(id))));
  if (snaps.some((snap) => !categoryRepo.fromSnapshot(snap, orgId))) {
    throw invalid("productAccess", "Choose valid categories");
  }
}

// ---- create --------------------------------------------------------------------------------

export async function createAgent(ctx: AgentCtx, input: AgentInput): Promise<Agent> {
  assertCtx(ctx);
  const orgId = ctx.organizationId;
  const fields = pick(input);
  if (typeof fields.name !== "string" || fields.name.length === 0) {
    throw invalid("name", "Enter the agent name");
  }
  fields.nameLower = sortKey(fields.name);
  fields.version = 1;
  fields.createdBy = ctx.uid;

  let id = "";
  await adminDb().runTransaction(async (tx) => {
    await assertCategories(tx, orgId, categoryIdsOf(fields.productAccess));
    const { ref, data } = buildAgent(orgId, fields);
    id = ref.id;
    tx.create(ref, data);
    writeAuditInTransaction(tx, {
      organizationId: orgId,
      actorUid: ctx.uid,
      action: "agent.create",
      resource: "agent",
      resourceId: ref.id,
      after: {
        name: fields.name,
        role: fields.role,
        status: fields.status,
        version: 1,
      },
    });
  });
  return getAgent(ctx, id);
}

// ---- read ----------------------------------------------------------------------------------

export async function getAgent(ctx: AgentCtx, id: string): Promise<Agent> {
  assertCtx(ctx);
  assertEntityId(id);
  const doc = await agentRepo.get(ctx.organizationId, id);
  if (!doc) throw new NotFoundError();
  return toAgent(doc);
}

export async function listAgents(ctx: AgentCtx, q: AgentListQuery): Promise<AgentPage> {
  assertCtx(ctx);
  const limit = resolveListLimit(q.limit, { defaultLimit: DEFAULT_LIMIT, maxLimit: MAX_LIMIT });
  const page = await agentRepo.list(ctx.organizationId, {
    orderBy: ["updatedAt", "desc"],
    limit,
    cursor: q.cursor,
  });
  return { items: page.items.map(toAgent), nextCursor: page.nextCursor };
}

// ---- update --------------------------------------------------------------------------------

/** Stored `model` may be absent; a cleared (null) value is the same as absent. */
const sameValue = (stored: unknown, next: unknown): boolean =>
  stableJson(stored ?? null) === stableJson(next ?? null);

export async function updateAgent(ctx: AgentCtx, id: string, patch: AgentPatch): Promise<Agent> {
  assertCtx(ctx);
  assertEntityId(id);
  const orgId = ctx.organizationId;
  const next = pick(patch);
  if (Object.keys(next).length === 0) throw invalid("body", "At least one field is required");
  if (next.name !== undefined && (typeof next.name !== "string" || next.name.length === 0)) {
    throw invalid("name", "Enter the agent name");
  }

  await adminDb().runTransaction(async (tx) => {
    const ref = agentRepo.docRef(id);
    const current = agentRepo.fromSnapshot(await tx.get(ref), orgId);
    if (!current) throw new NotFoundError();
    const stored = current as unknown as Fields;

    // Reads first: the categories must belong to this organization.
    if (next.productAccess !== undefined) {
      await assertCategories(tx, orgId, categoryIdsOf(next.productAccess));
    }

    const changed = INPUT_KEYS.filter(
      (key) => next[key] !== undefined && !sameValue(stored[key], next[key]),
    );
    if (changed.length === 0) return;

    const bumps = changed.some((key) => (VERSIONED_FIELDS as readonly string[]).includes(key));
    const version = bumps ? current.version + 1 : current.version;

    // Whole-value writes: a nested object replaces the stored one, `null` removes the field.
    const write: Fields = {};
    for (const key of changed) write[key] = next[key] === null ? FieldValue.delete() : next[key];
    if (changed.includes("name")) write.nameLower = sortKey(next.name as string);
    if (bumps) write.version = version;
    write.updatedAt = FieldValue.serverTimestamp();
    tx.update(ref, write);

    const base = {
      organizationId: orgId,
      actorUid: ctx.uid,
      resource: "agent",
      resourceId: id,
    };
    const statusChanged = changed.includes("status");
    if (!(statusChanged && changed.length === 1)) {
      writeAuditInTransaction(tx, {
        ...base,
        action: "agent.update",
        after: { changedFields: changed, version },
      });
    }
    if (statusChanged) {
      writeAuditInTransaction(tx, {
        ...base,
        action: next.status === "active" ? "agent.activate" : "agent.deactivate",
        before: { status: current.status },
        after: { status: next.status, version },
      });
    }
  });
  return getAgent(ctx, id);
}
