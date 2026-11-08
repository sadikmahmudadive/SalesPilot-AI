import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { agentInputSchema, agentPatchSchema } from "@/schemas/agent";
import { categoryInputSchema } from "@/schemas/product";
import { createCategory } from "@/services/products/categories";

import { createAgent, getAgent, listAgents, updateAgent } from "./agents";

// Failure seam: lets a test make the in-transaction audit write throw, to prove that the agent
// write in the same transaction does not survive.
const audit = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/security/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/audit")>();
  return {
    ...actual,
    writeAuditInTransaction: (...args: Parameters<typeof actual.writeAuditInTransaction>) => {
      if (audit.fail) throw new Error("audit unavailable");
      return actual.writeAuditInTransaction(...args);
    },
  };
});

const orgs: string[] = [];
function newCtx() {
  const organizationId = `org-${randomUUID()}`;
  orgs.push(organizationId);
  return { organizationId, uid: `uid-${randomUUID()}` };
}

let counter = 0;
function make(over: Record<string, unknown> = {}) {
  counter += 1;
  return agentInputSchema.parse({ name: `Agent ${counter}`, role: "retail_sales", ...over });
}
const patch = (p: Record<string, unknown>) => agentPatchSchema.parse(p);

const db = () => adminDb();
async function docsOf(collection: string, organizationId: string) {
  return (await db().collection(collection).where("organizationId", "==", organizationId).get())
    .docs;
}
const auditsOf = async (ctx: { organizationId: string }, action?: string) =>
  (await docsOf("auditLogs", ctx.organizationId)).filter(
    (d) => action === undefined || d.get("action") === action,
  );
const rawAgent = async (id: string) => (await db().collection("agents").doc(id).get()).data()!;
const rejection = async (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );

beforeEach(() => {
  audit.fail = false;
});

afterAll(async () => {
  const collections = ["agents", "categories", "categoryNames", "auditLogs"];
  await Promise.all(
    orgs.flatMap((org) =>
      collections.map(async (col) => {
        const docs = await docsOf(col, org);
        await Promise.all(docs.map((d) => db().recursiveDelete(d.ref)));
      }),
    ),
  );
}, 60_000);

describe("createAgent", () => {
  it("stores version 1, managed fields and nameLower, and audits without instruction text", async () => {
    const ctx = newCtx();
    const a = await createAgent(
      ctx,
      make({
        name: "  Sales   Bot ",
        instructions: "SECRET-INSTRUCTION-TEXT",
        personality: "SECRET-PERSONALITY-TEXT",
      }),
    );

    expect(a).toMatchObject({
      name: "Sales   Bot",
      role: "retail_sales",
      status: "inactive",
      version: 1,
      createdBy: ctx.uid,
      organizationId: ctx.organizationId,
      instructions: "SECRET-INSTRUCTION-TEXT",
    });
    expect(a.createdAt).toMatch(/^\d{4}-/);
    expect(a).not.toHaveProperty("nameLower");
    expect(await getAgent(ctx, a.id)).toEqual(a);
    expect((await rawAgent(a.id)).nameLower).toBe("sales bot");

    const rows = await auditsOf(ctx);
    expect(rows).toHaveLength(1);
    const row = rows[0]!.data();
    expect(row).toMatchObject({
      action: "agent.create",
      resource: "agent",
      resourceId: a.id,
      actorUid: ctx.uid,
      after: { name: "Sales   Bot", role: "retail_sales", status: "inactive", version: 1 },
    });
    expect(JSON.stringify(row)).not.toContain("SECRET");
  });

  it("ignores client-supplied managed fields", async () => {
    const ctx = newCtx();
    const other = newCtx();
    const input = {
      ...make(),
      id: "x",
      organizationId: other.organizationId,
      version: 99,
      createdBy: "attacker",
    };
    const a = await createAgent(ctx, input as never);
    expect(a.organizationId).toBe(ctx.organizationId);
    expect(a.version).toBe(1);
    expect(a.createdBy).toBe(ctx.uid);
    expect(a.id).not.toBe("x");
  });

  it("rejects category ids of another organization and persists nothing", async () => {
    const ctx = newCtx();
    const other = newCtx();
    const foreign = await createCategory(other, categoryInputSchema.parse({ name: "Foreign" }));
    const err = await rejection(
      createAgent(ctx, make({ productAccess: { mode: "categories", categoryIds: [foreign.id] } })),
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect(await docsOf("agents", ctx.organizationId)).toHaveLength(0);
    expect(await docsOf("auditLogs", ctx.organizationId)).toHaveLength(0);
  });

  it("accepts category ids of its own organization", async () => {
    const ctx = newCtx();
    const cat = await createCategory(ctx, categoryInputSchema.parse({ name: "Mine" }));
    const a = await createAgent(
      ctx,
      make({ productAccess: { mode: "categories", categoryIds: [cat.id] } }),
    );
    expect(a.productAccess).toEqual({ mode: "categories", categoryIds: [cat.id] });
  });

  it("persists nothing when the audit write fails", async () => {
    const ctx = newCtx();
    audit.fail = true;
    await expect(createAgent(ctx, make())).rejects.toThrow("audit unavailable");
    expect(await docsOf("agents", ctx.organizationId)).toHaveLength(0);
  });

  it("fails closed on a bad context", async () => {
    await expect(createAgent({ organizationId: "", uid: "u" }, make())).rejects.toThrow();
    await expect(createAgent({ organizationId: "o1", uid: " " }, make())).rejects.toThrow();
  });
});

describe("getAgent", () => {
  it("is NotFound across organizations and for bad ids", async () => {
    const ctx = newCtx();
    const other = newCtx();
    const a = await createAgent(ctx, make());
    expect(await rejection(getAgent(other, a.id))).toBeInstanceOf(NotFoundError);
    expect(await rejection(getAgent(ctx, "missing"))).toBeInstanceOf(NotFoundError);
    expect(await rejection(getAgent(ctx, "a/b"))).toBeInstanceOf(NotFoundError);
  });
});

describe("updateAgent: versioning", () => {
  it("keeps the version when only name, description or channels change", async () => {
    const ctx = newCtx();
    const a = await createAgent(ctx, make({ name: "Old name" }));
    const b = await updateAgent(
      ctx,
      a.id,
      patch({ name: "New name", description: "d", channels: ["test", "whatsapp"] }),
    );
    expect(b.version).toBe(1);
    expect(b.name).toBe("New name");
    expect(b.description).toBe("d");
    expect((await rawAgent(a.id)).nameLower).toBe("new name");
    expect(b.updatedAt >= a.updatedAt).toBe(true);
  });

  it("bumps the version when instructions change", async () => {
    const ctx = newCtx();
    const a = await createAgent(ctx, make({ instructions: "one" }));
    const b = await updateAgent(ctx, a.id, patch({ instructions: "two" }));
    expect(b.version).toBe(2);
    expect(b.instructions).toBe("two");
    const c = await updateAgent(ctx, a.id, patch({ instructions: "three", tools: ["get_price"] }));
    expect(c.version).toBe(3);
  });

  it("keeps the version for unchanged versioned values (deep compare)", async () => {
    const ctx = newCtx();
    const a = await createAgent(ctx, make({ tools: ["get_price", "check_stock"] }));
    const b = await updateAgent(
      ctx,
      a.id,
      patch({
        tools: ["get_price", "check_stock"],
        limits: { ...a.limits },
        escalation: { ...a.escalation },
        productAccess: { mode: "all" },
        instructions: a.instructions,
      }),
    );
    expect(b.version).toBe(1);
  });

  it("bumps when the tool order differs (arrays are compared in order)", async () => {
    const ctx = newCtx();
    const a = await createAgent(ctx, make({ tools: ["get_price", "check_stock"] }));
    const b = await updateAgent(ctx, a.id, patch({ tools: ["check_stock", "get_price"] }));
    expect(b.version).toBe(2);
  });

  it("does not bump the version for a role change, but writes the role", async () => {
    const ctx = newCtx();
    const a = await createAgent(ctx, make({ role: "retail_sales" }));
    const b = await updateAgent(ctx, a.id, patch({ role: "customer_support" }));
    expect(b.role).toBe("customer_support");
    expect(b.version).toBe(1);
    const row = (await auditsOf(ctx, "agent.update"))[0]!.data();
    expect(row.after.changedFields).toEqual(["role"]);
  });

  it("replaces nested objects wholesale: a cleared maxTurnsBeforeHandover is removed", async () => {
    const ctx = newCtx();
    const a = await createAgent(
      ctx,
      make({
        escalation: { keywords: ["refund"], onMissingInfo: true, maxTurnsBeforeHandover: 5 },
      }),
    );
    expect(a.escalation.maxTurnsBeforeHandover).toBe(5);
    const b = await updateAgent(
      ctx,
      a.id,
      patch({ escalation: { keywords: ["refund"], onMissingInfo: true } }),
    );
    expect(b.version).toBe(2);
    expect(b.escalation).toEqual({ keywords: ["refund"], onMissingInfo: true });
    const raw = await rawAgent(a.id);
    expect(raw.escalation).toEqual({ keywords: ["refund"], onMissingInfo: true });
    expect("maxTurnsBeforeHandover" in (raw.escalation as object)).toBe(false);
  });

  it("replaces productAccess wholesale (categories -> all drops categoryIds)", async () => {
    const ctx = newCtx();
    const cat = await createCategory(ctx, categoryInputSchema.parse({ name: "C" }));
    const a = await createAgent(
      ctx,
      make({ productAccess: { mode: "categories", categoryIds: [cat.id] } }),
    );
    const b = await updateAgent(ctx, a.id, patch({ productAccess: { mode: "all" } }));
    expect(b.version).toBe(2);
    expect((await rawAgent(a.id)).productAccess).toEqual({ mode: "all" });
  });

  it("sets and clears model (null deletes the field); both are versioned changes", async () => {
    const ctx = newCtx();
    const a = await createAgent(ctx, make());
    expect(a).not.toHaveProperty("model");
    const b = await updateAgent(ctx, a.id, patch({ model: "some-model" }));
    expect(b.model).toBe("some-model");
    expect(b.version).toBe(2);
    const c = await updateAgent(ctx, a.id, patch({ model: null }));
    expect(c).not.toHaveProperty("model");
    expect(c.version).toBe(3);
    expect("model" in (await rawAgent(a.id))).toBe(false);
    // Clearing an absent model is not a change.
    const d = await updateAgent(ctx, a.id, patch({ model: null }));
    expect(d.version).toBe(3);
  });

  it("is a no-op (no write, no audit, same updatedAt) when nothing changes", async () => {
    const ctx = newCtx();
    const a = await createAgent(ctx, make({ name: "Same" }));
    const before = (await auditsOf(ctx)).length;
    const b = await updateAgent(ctx, a.id, patch({ name: "Same", tools: [] }));
    expect(b).toEqual(a);
    expect((await auditsOf(ctx)).length).toBe(before);
  });
});

describe("updateAgent: tenancy and validation", () => {
  it("is NotFound across organizations and does not change the agent", async () => {
    const ctx = newCtx();
    const other = newCtx();
    const a = await createAgent(ctx, make({ name: "Mine" }));
    expect(await rejection(updateAgent(other, a.id, patch({ name: "Hacked" })))).toBeInstanceOf(
      NotFoundError,
    );
    expect(await rejection(updateAgent(ctx, "nope", patch({ name: "x" })))).toBeInstanceOf(
      NotFoundError,
    );
    expect((await getAgent(ctx, a.id)).name).toBe("Mine");
    expect(await auditsOf(other)).toHaveLength(0);
  });

  it("rejects foreign category ids with a ValidationError and changes nothing", async () => {
    const ctx = newCtx();
    const other = newCtx();
    const foreign = await createCategory(other, categoryInputSchema.parse({ name: "Foreign" }));
    const a = await createAgent(ctx, make());
    const err = await rejection(
      updateAgent(
        ctx,
        a.id,
        patch({
          name: "Renamed",
          productAccess: { mode: "categories", categoryIds: [foreign.id] },
        }),
      ),
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect(await getAgent(ctx, a.id)).toEqual(a);
  });

  it("persists nothing when the audit write fails", async () => {
    const ctx = newCtx();
    const a = await createAgent(ctx, make({ instructions: "one" }));
    audit.fail = true;
    await expect(updateAgent(ctx, a.id, patch({ instructions: "two" }))).rejects.toThrow(
      "audit unavailable",
    );
    audit.fail = false;
    expect(await getAgent(ctx, a.id)).toEqual(a);
  });
});

describe("updateAgent: audit", () => {
  it("writes agent.update with changed field names and the new version, without text", async () => {
    const ctx = newCtx();
    const a = await createAgent(ctx, make());
    await updateAgent(
      ctx,
      a.id,
      patch({ name: "Renamed", instructions: "SECRET-NEW-INSTRUCTIONS", tools: ["get_price"] }),
    );
    const rows = await auditsOf(ctx, "agent.update");
    expect(rows).toHaveLength(1);
    const row = rows[0]!.data();
    expect(row).toMatchObject({ resource: "agent", resourceId: a.id, actorUid: ctx.uid });
    expect([...row.after.changedFields].sort()).toEqual(["instructions", "name", "tools"]);
    expect(row.after.version).toBe(2);
    expect(JSON.stringify(row)).not.toContain("SECRET");
  });

  it("writes agent.activate / agent.deactivate for status-only changes (no agent.update row)", async () => {
    const ctx = newCtx();
    const a = await createAgent(ctx, make());
    const on = await updateAgent(ctx, a.id, patch({ status: "active" }));
    expect(on.status).toBe("active");
    expect(on.version).toBe(1);
    expect(await auditsOf(ctx, "agent.activate")).toHaveLength(1);
    expect(await auditsOf(ctx, "agent.update")).toHaveLength(0);
    const act = (await auditsOf(ctx, "agent.activate"))[0]!.data();
    expect(act).toMatchObject({
      resource: "agent",
      resourceId: a.id,
      before: { status: "inactive" },
      after: { status: "active", version: 1 },
    });

    await updateAgent(ctx, a.id, patch({ status: "inactive" }));
    expect(await auditsOf(ctx, "agent.deactivate")).toHaveLength(1);

    // Same status again: nothing changes, nothing is audited.
    await updateAgent(ctx, a.id, patch({ status: "inactive" }));
    expect(await auditsOf(ctx, "agent.deactivate")).toHaveLength(1);
  });

  it("writes BOTH agent.update and agent.activate when status and other fields change", async () => {
    const ctx = newCtx();
    const a = await createAgent(ctx, make());
    const b = await updateAgent(ctx, a.id, patch({ status: "active", instructions: "go" }));
    expect(b.status).toBe("active");
    expect(b.version).toBe(2);
    const upd = await auditsOf(ctx, "agent.update");
    const act = await auditsOf(ctx, "agent.activate");
    expect(upd).toHaveLength(1);
    expect(act).toHaveLength(1);
    expect([...upd[0]!.data().after.changedFields].sort()).toEqual(["instructions", "status"]);
    expect(upd[0]!.data().after.version).toBe(2);
    expect(act[0]!.data().after).toMatchObject({ status: "active", version: 2 });
  });
});

describe("listAgents", () => {
  it("is scoped to the organization and ordered by updatedAt desc", async () => {
    const ctx = newCtx();
    const other = newCtx();
    await createAgent(other, make({ name: "Foreign" }));
    const a = await createAgent(ctx, make({ name: "A" }));
    const b = await createAgent(ctx, make({ name: "B" }));
    const c = await createAgent(ctx, make({ name: "C" }));
    expect((await listAgents(ctx, {})).items.map((x) => x.id)).toEqual([c.id, b.id, a.id]);

    await updateAgent(ctx, a.id, patch({ name: "A2" }));
    const page = await listAgents(ctx, {});
    expect(page.items.map((x) => x.id)).toEqual([a.id, c.id, b.id]);
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).not.toHaveProperty("nameLower");
  });

  it("paginates without duplicates or gaps", async () => {
    const ctx = newCtx();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await createAgent(ctx, make())).id);

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listAgents(ctx, { limit: 2, cursor });
      seen.push(...page.items.map((x) => x.id));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(5);
    expect(seen).toEqual([...ids].reverse());
  });

  it("rejects invalid limits and malformed cursors", async () => {
    const ctx = newCtx();
    expect(await rejection(listAgents(ctx, { limit: 0 }))).toBeInstanceOf(ValidationError);
    expect(await rejection(listAgents(ctx, { limit: 1000 }))).toBeInstanceOf(ValidationError);
    expect(await rejection(listAgents(ctx, { cursor: "garbage" }))).toBeInstanceOf(ValidationError);
  });
});
