import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it, vi } from "vitest";

const race = vi.hoisted(() => ({ pretendMissing: 0 }));
vi.mock("./crm-access", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./crm-access")>();
  return {
    ...orig,
    // Simulates the race: the first lookups miss a customer that is created before the write.
    findCustomerByPhone: async (...args: Parameters<typeof orig.findCustomerByPhone>) => {
      if (race.pretendMissing > 0) {
        race.pretendMissing -= 1;
        return null;
      }
      return orig.findCustomerByPhone(...args);
    },
  };
});

import { adminDb } from "@/lib/firebase/admin";
import { agentInputSchema, type Agent, type AgentChannel } from "@/schemas/agent";
import { customerInputSchema } from "@/schemas/customer";
import { createCustomer, getCustomer } from "@/services/crm/customers";

import { dhakaDate } from "./ai-notes";
import { executeTool } from "./registry";
import type { ToolContext, ToolOutcome } from "./types";

const orgs: string[] = [];
const newOrg = () => {
  const id = `org-${randomUUID()}`;
  orgs.push(id);
  return id;
};
const ORG = newOrg();
const OTHER_ORG = newOrg();
const ctxOf = (organizationId: string) => ({ organizationId, uid: "uid-seed" });

let counter = 0;
function makeAgent(organizationId: string, over: Record<string, unknown> = {}): Agent {
  counter += 1;
  return {
    ...agentInputSchema.parse({
      name: `Agent ${counter}`,
      role: "retail_sales",
      tools: ["lookup_customer", "save_customer_info", "escalate_to_human"],
      ...over,
    }),
    id: `agent-${counter}`,
    organizationId,
    version: 1,
    createdBy: "uid-seed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function toolCtx(
  agent: Agent,
  channel: AgentChannel = "test",
  extra: Partial<ToolContext> = {},
): ToolContext {
  return {
    organizationId: agent.organizationId,
    agent,
    sessionId: "session-1",
    channel,
    actorUid: "uid-seed",
    ...extra,
  };
}

const call = (ctx: ToolContext, name: string, args: unknown): Promise<ToolOutcome<unknown>> =>
  executeTool(ctx, name, JSON.stringify(args));

function okOf(r: ToolOutcome<unknown>) {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
  return r;
}

const count = async (col: string, org: string): Promise<number> =>
  (await adminDb().collection(col).where("organizationId", "==", org).count().get()).data().count;

const seedCustomer = (org: string, over: Record<string, unknown> = {}) =>
  createCustomer(
    ctxOf(org),
    customerInputSchema.parse({
      fullName: "Existing Person",
      phone: "01711000001",
      email: "existing@example.com",
      address: "House 1, Road 2",
      segment: "interested",
      preferences: { language: "bn", notes: "likes red" },
      ...over,
    }),
  );

afterAll(async () => {
  const collections = ["customers", "customerPhones", "auditLogs", "agentSessionsTest"];
  await Promise.all(
    orgs.flatMap((org) =>
      collections.map(async (col) => {
        const snap = await adminDb().collection(col).where("organizationId", "==", org).get();
        await Promise.all(snap.docs.map((d) => adminDb().recursiveDelete(d.ref)));
      }),
    ),
  );
}, 120_000);

describe("lookup_customer", () => {
  it("finds a customer by local and +880 formats, returning only exists/fullName/segment", async () => {
    await seedCustomer(ORG);
    const ctx = toolCtx(makeAgent(ORG));
    for (const phone of ["01711000001", "+8801711000001", "8801711000001", "01711-000 001"]) {
      const r = okOf(await call(ctx, "lookup_customer", { phone }));
      expect(r.data).toEqual({
        exists: true,
        fullName: "Existing Person",
        segment: "interested",
      });
      expect(r.dryRunAction).toBeUndefined();
    }
    const serialized = JSON.stringify(await call(ctx, "lookup_customer", { phone: "01711000001" }));
    for (const secret of ["existing@example.com", "House 1", "likes red", "1711000001"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("answers exists:false for an unknown number and for a number in another organization", async () => {
    await seedCustomer(OTHER_ORG, { phone: "01711000002", fullName: "Foreign Person" });
    const ctx = toolCtx(makeAgent(ORG));
    expect(okOf(await call(ctx, "lookup_customer", { phone: "01711999999" })).data).toEqual({
      exists: false,
    });
    expect(okOf(await call(ctx, "lookup_customer", { phone: "01711000002" })).data).toEqual({
      exists: false,
    });
  });

  it("rejects an invalid phone with a static message that does not echo it", async () => {
    const ctx = toolCtx(makeAgent(ORG));
    const r = await call(ctx, "lookup_customer", { phone: "not-a-number-9f3" });
    expect(r).toMatchObject({ ok: false, code: "invalid" });
    expect(JSON.stringify(r)).not.toContain("9f3");
  });
});

describe("save_customer_info on the test channel (dry run)", () => {
  it("returns a create_customer dry run for a new phone and writes nothing", async () => {
    const org = newOrg();
    const ctx = toolCtx(makeAgent(org), "test");
    const before = [await count("customers", org), await count("customerPhones", org)];
    const r = okOf(
      await call(ctx, "save_customer_info", {
        phone: "01811000001",
        fullName: "Rahim Uddin",
        address: "Dhaka",
        email: "rahim@example.com",
        notes: "wants a quote",
        segment: "interested",
      }),
    );
    expect(r.data).toEqual({ action: "create" });
    expect(r.dryRunAction?.kind).toBe("create_customer");
    expect(r.dryRunAction?.fields).toMatchObject({
      fullName: "Rahim Uddin",
      address: "Dhaka",
      email: "rahim@example.com",
      segment: "interested",
      preferences: { notes: `[AI ${dhakaDate()}] wants a quote` },
    });
    for (const internal of ["phoneE164", "whatsappE164", "tagsLower", "fullNameLower"]) {
      expect(r.dryRunAction?.fields).not.toHaveProperty(internal);
    }
    expect([await count("customers", org), await count("customerPhones", org)]).toEqual(before);
    expect(await count("auditLogs", org)).toBe(0);
  });

  it("returns an update_customer dry run with only the provided fields and leaves the customer unchanged", async () => {
    const org = newOrg();
    const seeded = await seedCustomer(org, { phone: "01811000002" });
    const ctx = toolCtx(makeAgent(org), "test");
    const auditBefore = await count("auditLogs", org);
    const r = okOf(
      await call(ctx, "save_customer_info", {
        phone: "+8801811000002",
        address: "New address 5",
      }),
    );
    expect(r.data).toEqual({ action: "update" });
    expect(r.dryRunAction).toEqual({
      kind: "update_customer",
      fields: { address: "New address 5" },
    });
    expect(await getCustomer(ctxOf(org), seeded.id)).toEqual(seeded);
    expect(await count("auditLogs", org)).toBe(auditBefore);
  });

  it("reports only the new dated note entry in the dry run (stored notes are not shown)", async () => {
    const org = newOrg();
    const seeded = await seedCustomer(org, { phone: "01811000003" });
    const ctx = toolCtx(makeAgent(org), "test");
    const r = okOf(
      await call(ctx, "save_customer_info", { phone: "01811000003", notes: "prefers morning" }),
    );
    expect(r.dryRunAction?.fields).toEqual({ notes: `[AI ${dhakaDate()}] prefers morning` });
    expect((await getCustomer(ctxOf(org), seeded.id)).preferences?.notes).toBe("likes red");
  });

  it("rejects a segment the assistant may not set, in the test channel too, with no write", async () => {
    const org = newOrg();
    const ctx = toolCtx(makeAgent(org), "test");
    for (const segment of ["converted", "repeat_customer", "wholesale_customer", "inactive"]) {
      expect(
        await call(ctx, "save_customer_info", { phone: "01811000009", fullName: "A B", segment }),
      ).toEqual({
        ok: false,
        code: "invalid",
        message: "That segment can't be set by the assistant.",
      });
    }
    expect(await count("customers", org)).toBe(0);
    for (const segment of ["new_lead", "interested", "qualified_lead", "potential_buyer"]) {
      okOf(
        await call(ctx, "save_customer_info", { phone: "01811000009", fullName: "A B", segment }),
      );
    }
  });

  it("needs a name to create, with a static message", async () => {
    const org = newOrg();
    const ctx = toolCtx(makeAgent(org), "test");
    const r = await call(ctx, "save_customer_info", {
      phone: "01811000004",
      address: "secret-addr",
    });
    expect(r).toEqual({
      ok: false,
      code: "invalid",
      message: "A name is needed to create a new customer.",
    });
  });

  it("rejects an invalid phone or invalid fields without echoing them", async () => {
    const org = newOrg();
    const ctx = toolCtx(makeAgent(org), "test");
    const badPhone = await call(ctx, "save_customer_info", {
      phone: "zzz-secret-777",
      fullName: "A B",
    });
    expect(badPhone).toMatchObject({ ok: false, code: "invalid" });
    expect(JSON.stringify(badPhone)).not.toContain("777");
    const badEmail = await call(ctx, "save_customer_info", {
      phone: "01811000005",
      fullName: "A B",
      email: "not-an-email-secret",
    });
    expect(badEmail).toMatchObject({ ok: false, code: "invalid" });
    expect(JSON.stringify(badEmail)).not.toContain("secret");
    const badSegment = await call(ctx, "save_customer_info", {
      phone: "01811000005",
      fullName: "A B",
      segment: "vip",
    });
    expect(badSegment).toMatchObject({ ok: false, code: "invalid" });
    expect(await count("customers", org)).toBe(0);
  });

  it("treats blank optional strings as not provided (never clears stored fields)", async () => {
    const org = newOrg();
    await seedCustomer(org, { phone: "01811000006" });
    const ctx = toolCtx(makeAgent(org), "test");
    const r = okOf(
      await call(ctx, "save_customer_info", {
        phone: "01811000006",
        email: "   ",
        address: "",
        fullName: "Renamed Person",
      }),
    );
    expect(r.dryRunAction?.fields).toEqual({ fullName: "Renamed Person" });
  });

  it("rejects an update with nothing to change", async () => {
    const org = newOrg();
    await seedCustomer(org, { phone: "01811000007" });
    const ctx = toolCtx(makeAgent(org), "test");
    expect(await call(ctx, "save_customer_info", { phone: "01811000007" })).toMatchObject({
      ok: false,
      code: "invalid",
    });
  });

  it("does not see a customer of another organization (a create dry run instead)", async () => {
    const org = newOrg();
    await seedCustomer(OTHER_ORG, { phone: "01811000008" });
    const ctx = toolCtx(makeAgent(org), "test");
    const r = okOf(
      await call(ctx, "save_customer_info", { phone: "01811000008", fullName: "Mine Now" }),
    );
    expect(r.data).toEqual({ action: "create" });
  });
});

describe("save_customer_info on live channels", () => {
  it.each(["whatsapp", "voice"] as const)(
    "creates a customer on %s, audited as the agent",
    async (channel) => {
      const org = newOrg();
      const agent = makeAgent(org);
      const ctx = toolCtx(agent, channel, { contactPhoneE164: "+8801911000001" });
      const r = okOf(
        await call(ctx, "save_customer_info", {
          phone: "01911000001",
          fullName: "Karim Hossain",
          segment: "qualified_lead",
          notes: "asked about wholesale",
        }),
      );
      expect(r.dryRunAction).toBeUndefined();
      const data = r.data as { action: string; customerId: string };
      expect(data.action).toBe("create");
      const stored = await getCustomer(ctxOf(org), data.customerId);
      expect(stored).toMatchObject({
        fullName: "Karim Hossain",
        phoneE164: "+8801911000001",
        segment: "qualified_lead",
        preferences: { notes: `[AI ${dhakaDate()}] asked about wholesale` },
      });
      const audit = await adminDb()
        .collection("auditLogs")
        .where("organizationId", "==", org)
        .where("resourceId", "==", data.customerId)
        .get();
      expect(audit.docs.map((d) => [d.get("action"), d.get("actorUid")])).toEqual([
        ["customer.create", `ai-agent:${agent.id}`],
      ]);
      // The same number now resolves to the existing customer.
      expect(okOf(await call(ctx, "lookup_customer", { phone: "+8801911000001" })).data).toEqual({
        exists: true,
        fullName: "Karim Hossain",
        segment: "qualified_lead",
      });
    },
  );

  it("updates an existing customer with only the provided fields, appending the AI note", async () => {
    const org = newOrg();
    const seeded = await seedCustomer(org, { phone: "01911000002" });
    const agent = makeAgent(org);
    const ctx = toolCtx(agent, "whatsapp", { contactPhoneE164: "+8801911000002" });
    const r = okOf(
      await call(ctx, "save_customer_info", {
        phone: "01911000002",
        notes: "now prefers evening",
        segment: "potential_buyer",
      }),
    );
    expect(r.data).toEqual({ action: "update", customerId: seeded.id });
    const stored = await getCustomer(ctxOf(org), seeded.id);
    expect(stored.segment).toBe("potential_buyer");
    expect(stored.preferences).toEqual({
      language: "bn",
      notes: `likes red\n[AI ${dhakaDate()}] now prefers evening`,
    });
    expect(stored.fullName).toBe("Existing Person");
    expect(stored.email).toBe("existing@example.com");
    expect(stored.address).toBe("House 1, Road 2");
    const audit = await adminDb()
      .collection("auditLogs")
      .where("organizationId", "==", org)
      .where("action", "==", "customer.update")
      .get();
    expect(audit.docs.map((d) => d.get("actorUid"))).toEqual([`ai-agent:${agent.id}`]);
  });

  it("never touches a customer of another organization", async () => {
    const org = newOrg();
    const foreign = await seedCustomer(OTHER_ORG, { phone: "01911000003" });
    const ctx = toolCtx(makeAgent(org), "whatsapp", { contactPhoneE164: "+8801911000003" });
    const r = okOf(
      await call(ctx, "save_customer_info", { phone: "01911000003", fullName: "Intruder" }),
    );
    expect((r.data as { action: string }).action).toBe("create");
    expect((await getCustomer(ctxOf(OTHER_ORG), foreign.id)).fullName).toBe("Existing Person");
  });

  it("fails closed with a static message when the write errors, logging no personal data", async () => {
    const org = newOrg();
    const ctx = toolCtx(makeAgent(org), "whatsapp", { contactPhoneE164: "+8801911000004" });
    const { logger } = await import("@/lib/logger");
    const spy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const blocker = adminDb().collection("customerPhones").doc(`${org}_+8801911000004`);
    await blocker.set({ organizationId: "someone-else", customerId: "x" });
    const r = await call(ctx, "save_customer_info", {
      phone: "01911000004",
      fullName: "Race Loser",
    });
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    await blocker.delete();
    expect(r).toMatchObject({ ok: false, code: "failed" });
    expect(logged).toContain("save_customer_info");
    expect(logged).not.toMatch(/Race Loser|1911000004/);
  });
});

describe("live channels are bound to the conversing customer", () => {
  it("drops the oldest note lines first and keeps the new entry when notes get too long", async () => {
    const org = newOrg();
    const old = Array.from({ length: 9 }, (_, i) => `${i}`.repeat(100)).join("\n");
    const seeded = await seedCustomer(org, {
      phone: "01911000010",
      preferences: { notes: old },
    });
    const ctx = toolCtx(makeAgent(org), "whatsapp", { contactPhoneE164: "+8801911000010" });
    okOf(await call(ctx, "save_customer_info", { phone: "01911000010", notes: "z".repeat(300) }));
    const notes = (await getCustomer(ctxOf(org), seeded.id)).preferences?.notes ?? "";
    expect(notes.length).toBeLessThanOrEqual(1000);
    expect(notes.endsWith(`[AI ${dhakaDate()}] ${"z".repeat(300)}`)).toBe(true);
    expect(notes).not.toContain("0".repeat(100));
    expect(notes).toContain("8".repeat(100));
  });

  it.each(["whatsapp", "voice"] as const)(
    "denies lookup and save on %s for another number or without a contact, writing nothing",
    async (channel) => {
      const org = newOrg();
      const seeded = await seedCustomer(org, { phone: "01911000011" });
      const other = await seedCustomer(org, { phone: "01911000012", fullName: "Other Person" });
      const wrong = toolCtx(makeAgent(org), channel, { contactPhoneE164: "+8801911000011" });
      const none = toolCtx(makeAgent(org), channel);
      for (const [ctx, target] of [
        [wrong, "01911000012"],
        [none, "01911000011"],
      ] as const) {
        const lookup = await call(ctx, "lookup_customer", { phone: target });
        expect(lookup).toMatchObject({ ok: false, code: "denied" });
        expect(JSON.stringify(lookup)).not.toContain("Other Person");
        const save = await call(ctx, "save_customer_info", {
          phone: target,
          fullName: "Hijacked",
          notes: "x",
          segment: "interested",
        });
        expect(save).toMatchObject({ ok: false, code: "denied" });
        const unknown = await call(ctx, "save_customer_info", {
          phone: "01911000013",
          fullName: "Brand New",
        });
        expect(unknown).toMatchObject({ ok: false, code: "denied" });
      }
      expect(await getCustomer(ctxOf(org), other.id)).toEqual(other);
      expect(await getCustomer(ctxOf(org), seeded.id)).toEqual(seeded);
      expect(await count("customers", org)).toBe(2);
      expect(await count("auditLogs", org)).toBe(2); // the two seed creates only
    },
  );

  it("allows the matching number in any input format, for lookup and save", async () => {
    const org = newOrg();
    await seedCustomer(org, { phone: "01911000014" });
    const ctx = toolCtx(makeAgent(org), "whatsapp", { contactPhoneE164: "+8801911000014" });
    for (const phone of ["01911000014", "+8801911000014", "8801911-000014"]) {
      expect(okOf(await call(ctx, "lookup_customer", { phone })).data).toMatchObject({
        exists: true,
      });
    }
    expect(
      okOf(await call(ctx, "save_customer_info", { phone: "+88 01911 000014", address: "A 1" }))
        .data,
    ).toMatchObject({ action: "update" });
  });

  it("rejects a segment the assistant may not set on live channels, with no write", async () => {
    const org = newOrg();
    const seeded = await seedCustomer(org, { phone: "01911000015" });
    const ctx = toolCtx(makeAgent(org), "whatsapp", { contactPhoneE164: "+8801911000015" });
    const r = await call(ctx, "save_customer_info", { phone: "01911000015", segment: "converted" });
    expect(r).toEqual({
      ok: false,
      code: "invalid",
      message: "That segment can't be set by the assistant.",
    });
    expect((await getCustomer(ctxOf(org), seeded.id)).segment).toBe("interested");
  });

  it("retries as an update once when the create loses a race for the same number", async () => {
    const org = newOrg();
    const seeded = await seedCustomer(org, { phone: "01911000016" });
    const ctx = toolCtx(makeAgent(org), "whatsapp", { contactPhoneE164: "+8801911000016" });
    race.pretendMissing = 1;
    const r = okOf(
      await call(ctx, "save_customer_info", { phone: "01911000016", fullName: "Raced Name" }),
    );
    race.pretendMissing = 0;
    expect(r.data).toEqual({ action: "update", customerId: seeded.id });
    expect((await getCustomer(ctxOf(org), seeded.id)).fullName).toBe("Raced Name");
    expect(await count("customers", org)).toBe(1);
  });
});

describe("forged or stale phone locks", () => {
  it.each([
    ["points at another organization's customer", "own"],
    ["carries a foreign organizationId", "foreign"],
  ] as const)("treats a lock that %s as missing", async (_label, kind) => {
    const org = newOrg();
    const foreignOrg = newOrg();
    const foreign = await seedCustomer(foreignOrg, { phone: "01911000020" });
    const lock = adminDb().collection("customerPhones").doc(`${org}_+8801911000021`);
    await lock.set({
      organizationId: kind === "own" ? org : foreignOrg,
      customerId: foreign.id,
      phoneE164: "+8801911000021",
    });
    try {
      const test = toolCtx(makeAgent(org), "test");
      expect(okOf(await call(test, "lookup_customer", { phone: "01911000021" })).data).toEqual({
        exists: false,
      });
      const dry = okOf(
        await call(test, "save_customer_info", { phone: "01911000021", fullName: "Forger" }),
      );
      expect(dry.data).toEqual({ action: "create" });
      const live = toolCtx(makeAgent(org), "whatsapp", { contactPhoneE164: "+8801911000021" });
      const r = await call(live, "save_customer_info", {
        phone: "01911000021",
        fullName: "Forger",
        notes: "x",
      });
      expect(r).toMatchObject({ ok: false, code: "failed" });
      expect(await getCustomer(ctxOf(foreignOrg), foreign.id)).toEqual(foreign);
    } finally {
      await lock.delete();
    }
  });
});

describe("escalate_to_human", () => {
  it("treats an unknown channel as a dry run (fails closed)", async () => {
    const escalateSession = vi.fn(async () => undefined);
    const ctx = toolCtx(makeAgent(ORG), "sms" as unknown as AgentChannel, { escalateSession });
    const r = okOf(await call(ctx, "escalate_to_human", { reason: "help" }));
    expect(r.dryRunAction?.kind).toBe("escalate");
    expect(escalateSession).not.toHaveBeenCalled();
  });

  it("returns a dry run on the test channel, calls nothing and leaves the session untouched", async () => {
    const org = newOrg();
    const session = adminDb().collection("agentSessionsTest").doc(randomUUID());
    await session.set({ organizationId: org, status: "active" });
    const escalateSession = vi.fn(async () => undefined);
    const ctx = toolCtx(makeAgent(org), "test", { sessionId: session.id, escalateSession });
    const r = okOf(await call(ctx, "escalate_to_human", { reason: "Customer is angry" }));
    expect(r.dryRunAction).toEqual({ kind: "escalate", fields: { reason: "Customer is angry" } });
    expect(escalateSession).not.toHaveBeenCalled();
    expect((await session.get()).data()).toEqual({ organizationId: org, status: "active" });
  });

  it.each(["whatsapp", "voice"] as const)(
    "calls the injected escalation on %s",
    async (channel) => {
      const escalateSession = vi.fn<NonNullable<ToolContext["escalateSession"]>>(
        async () => undefined,
      );
      const ctx = toolCtx(makeAgent(ORG), channel, { sessionId: "sess-9", escalateSession });
      const r = okOf(await call(ctx, "escalate_to_human", { reason: "Wants a refund" }));
      expect(r.dryRunAction).toBeUndefined();
      expect(escalateSession).toHaveBeenCalledExactlyOnceWith("sess-9", "Wants a refund");
    },
  );

  it("fails (without leaking the reason) when no escalation hook is wired on a live channel", async () => {
    const ctx = toolCtx(makeAgent(ORG), "whatsapp");
    const r = await call(ctx, "escalate_to_human", { reason: "secret-reason-42" });
    expect(r).toMatchObject({ ok: false, code: "failed" });
    expect(JSON.stringify(r)).not.toContain("secret-reason-42");
  });

  it("fails when the escalation hook throws", async () => {
    const escalateSession = vi.fn(async () => {
      throw new Error("boom secret-reason-43");
    });
    const ctx = toolCtx(makeAgent(ORG), "voice", { escalateSession });
    const r = await call(ctx, "escalate_to_human", { reason: "secret-reason-43" });
    expect(r).toMatchObject({ ok: false, code: "failed" });
    expect(JSON.stringify(r)).not.toContain("secret-reason-43");
  });

  it("rejects an empty or over-long reason", async () => {
    const ctx = toolCtx(makeAgent(ORG), "test");
    for (const reason of ["", "   ", "x".repeat(301)]) {
      expect(await call(ctx, "escalate_to_human", { reason })).toMatchObject({
        ok: false,
        code: "invalid",
      });
    }
  });
});
