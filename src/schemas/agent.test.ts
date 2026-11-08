import { describe, expect, it } from "vitest";

import {
  AGENT_CHANNELS,
  AGENT_LANGUAGES,
  AGENT_ROLES,
  TOOL_NAMES,
  VERSIONED_FIELDS,
  WRITE_TOOLS,
  agentInputSchema,
  agentPatchSchema,
} from "./agent";

const base = (over: Record<string, unknown> = {}) => ({
  name: "Sales Bot",
  role: "retail_sales",
  ...over,
});

const ok = (over: Record<string, unknown> = {}) => {
  const r = agentInputSchema.safeParse(base(over));
  if (!r.success) throw new Error(JSON.stringify(r.error.issues));
  return r.data;
};
const bad = (over: Record<string, unknown> = {}) => agentInputSchema.safeParse(base(over));
const patchOk = (input: unknown) => {
  const r = agentPatchSchema.safeParse(input);
  if (!r.success) throw new Error(JSON.stringify(r.error.issues));
  return r.data;
};
const patchBad = (input: unknown) => agentPatchSchema.safeParse(input);

const ids = (n: number) => Array.from({ length: n }, (_, i) => `cat${i}`);

describe("constants", () => {
  it("lists the roles, languages, channels and tools", () => {
    expect([...AGENT_ROLES]).toEqual([
      "retail_sales",
      "wholesale_sales",
      "customer_support",
      "order_management",
      "voice_sales",
    ]);
    expect([...AGENT_LANGUAGES]).toEqual(["bn", "en", "banglish"]);
    expect([...AGENT_CHANNELS]).toEqual(["test", "whatsapp", "voice"]);
    expect([...TOOL_NAMES]).toEqual([
      "search_products",
      "get_product_details",
      "get_price",
      "check_stock",
      "calculate_order_total",
      "lookup_customer",
      "save_customer_info",
      "escalate_to_human",
    ]);
  });

  it("marks exactly the two tools that write data", () => {
    expect([...WRITE_TOOLS].sort()).toEqual(["escalate_to_human", "save_customer_info"]);
  });

  it("versions exactly the ten behaviour fields", () => {
    expect([...VERSIONED_FIELDS].sort()).toEqual(
      [
        "personality",
        "instructions",
        "objectives",
        "languages",
        "tools",
        "productAccess",
        "escalation",
        "limits",
        "responseStyle",
        "model",
      ].sort(),
    );
  });
});

describe("agentInputSchema defaults", () => {
  it("applies the documented defaults to a minimal input", () => {
    expect(ok()).toEqual({
      name: "Sales Bot",
      role: "retail_sales",
      status: "inactive",
      description: "",
      personality: "",
      instructions: "",
      objectives: [],
      languages: ["bn", "en", "banglish"],
      tools: [],
      productAccess: { mode: "all" },
      channels: ["test"],
      escalation: { keywords: [], onMissingInfo: true },
      limits: { maxTurnsPerSession: 30, maxToolCallsPerTurn: 4, maxOutputTokens: 600 },
      responseStyle: "concise",
    });
  });

  it("requires a name and a known role", () => {
    expect(agentInputSchema.safeParse({ role: "retail_sales" }).success).toBe(false);
    expect(agentInputSchema.safeParse({ name: "x" }).success).toBe(false);
    expect(bad({ role: "boss" }).success).toBe(false);
  });

  it("strips unknown and managed keys", () => {
    const out = ok({
      version: 9,
      organizationId: "evil",
      createdBy: "evil",
      id: "x",
      nameLower: "x",
      extra: true,
    });
    for (const key of ["version", "organizationId", "createdBy", "id", "nameLower", "extra"]) {
      expect(out).not.toHaveProperty(key);
    }
  });
});

describe("agentInputSchema field bounds", () => {
  it("trims the name and enforces 1-80 characters", () => {
    expect(ok({ name: "  Bot  " }).name).toBe("Bot");
    expect(bad({ name: "" }).success).toBe(false);
    expect(bad({ name: "   " }).success).toBe(false);
    expect(bad({ name: "a".repeat(81) }).success).toBe(false);
    expect(ok({ name: "a".repeat(80) }).name).toHaveLength(80);
    expect(bad({ name: 5 }).success).toBe(false);
  });

  it("bounds description at 500, personality at 1000 and instructions at 8000", () => {
    expect(ok({ description: "a".repeat(500) }).description).toHaveLength(500);
    expect(bad({ description: "a".repeat(501) }).success).toBe(false);
    expect(ok({ personality: "a".repeat(1000) }).personality).toHaveLength(1000);
    expect(bad({ personality: "a".repeat(1001) }).success).toBe(false);
    expect(ok({ instructions: "a".repeat(8000) }).instructions).toHaveLength(8000);
    expect(bad({ instructions: "a".repeat(8001) }).success).toBe(false);
  });

  it("allows up to 10 objectives of 1-200 characters", () => {
    expect(ok({ objectives: Array(10).fill("Close the sale") }).objectives).toHaveLength(10);
    expect(bad({ objectives: Array(11).fill("x") }).success).toBe(false);
    expect(ok({ objectives: ["a".repeat(200)] }).objectives).toHaveLength(1);
    expect(bad({ objectives: ["a".repeat(201)] }).success).toBe(false);
    expect(bad({ objectives: [""] }).success).toBe(false);
    expect(bad({ objectives: ["   "] }).success).toBe(false);
  });

  it("requires a non-empty unique list of known languages", () => {
    expect(ok({ languages: ["bn"] }).languages).toEqual(["bn"]);
    expect(bad({ languages: [] }).success).toBe(false);
    expect(bad({ languages: ["bn", "bn"] }).success).toBe(false);
    expect(bad({ languages: ["fr"] }).success).toBe(false);
  });

  it("accepts a unique subset of known tools", () => {
    expect(ok({ tools: [...TOOL_NAMES] }).tools).toHaveLength(TOOL_NAMES.length);
    expect(ok({ tools: ["get_price"] }).tools).toEqual(["get_price"]);
    expect(bad({ tools: ["get_price", "get_price"] }).success).toBe(false);
    expect(bad({ tools: ["drop_database"] }).success).toBe(false);
  });

  it("accepts all-products access or 1-20 valid category ids", () => {
    expect(ok({ productAccess: { mode: "all" } }).productAccess).toEqual({ mode: "all" });
    expect(
      ok({ productAccess: { mode: "categories", categoryIds: ["c1", "c2"] } }).productAccess,
    ).toEqual({ mode: "categories", categoryIds: ["c1", "c2"] });
    expect(
      ok({ productAccess: { mode: "categories", categoryIds: ids(20) } }).productAccess,
    ).toMatchObject({ mode: "categories" });
    expect(bad({ productAccess: { mode: "categories", categoryIds: ids(21) } }).success).toBe(
      false,
    );
    expect(bad({ productAccess: { mode: "categories", categoryIds: [] } }).success).toBe(false);
    expect(bad({ productAccess: { mode: "categories" } }).success).toBe(false);
    expect(bad({ productAccess: { mode: "categories", categoryIds: ["a/b"] } }).success).toBe(
      false,
    );
    expect(bad({ productAccess: { mode: "categories", categoryIds: [".."] } }).success).toBe(false);
    expect(bad({ productAccess: { mode: "categories", categoryIds: ["c1", "c1"] } }).success).toBe(
      false,
    );
    expect(bad({ productAccess: { mode: "some" } }).success).toBe(false);
  });

  it("drops category ids sent with mode all", () => {
    expect(ok({ productAccess: { mode: "all", categoryIds: ["c1"] } }).productAccess).toEqual({
      mode: "all",
    });
  });

  it("always includes the test channel", () => {
    expect(ok({ channels: ["test", "whatsapp"] }).channels).toEqual(["test", "whatsapp"]);
    expect(ok({ channels: ["test", "whatsapp", "voice"] }).channels).toHaveLength(3);
    expect(bad({ channels: ["whatsapp"] }).success).toBe(false);
    expect(bad({ channels: [] }).success).toBe(false);
    expect(bad({ channels: ["test", "test"] }).success).toBe(false);
    expect(bad({ channels: ["test", "sms"] }).success).toBe(false);
  });

  it("bounds escalation keywords and the handover turn count", () => {
    const kw = (n: number) => Array.from({ length: n }, (_, i) => `kw${i}`);
    expect(
      ok({ escalation: { keywords: kw(20), onMissingInfo: false } }).escalation.keywords,
    ).toHaveLength(20);
    expect(bad({ escalation: { keywords: kw(21), onMissingInfo: false } }).success).toBe(false);
    expect(bad({ escalation: { keywords: ["a".repeat(41)], onMissingInfo: false } }).success).toBe(
      false,
    );
    expect(bad({ escalation: { keywords: ["a".repeat(40)], onMissingInfo: false } }).success).toBe(
      true,
    );
    expect(bad({ escalation: { keywords: [""], onMissingInfo: false } }).success).toBe(false);
    expect(bad({ escalation: { keywords: [], onMissingInfo: "yes" } }).success).toBe(false);

    const withTurns = (n: unknown) =>
      bad({ escalation: { keywords: [], onMissingInfo: true, maxTurnsBeforeHandover: n } });
    expect(withTurns(1).success).toBe(true);
    expect(withTurns(50).success).toBe(true);
    expect(withTurns(0).success).toBe(false);
    expect(withTurns(51).success).toBe(false);
    expect(withTurns(2.5).success).toBe(false);
    expect(ok({ escalation: { keywords: [], onMissingInfo: true } }).escalation).not.toHaveProperty(
      "maxTurnsBeforeHandover",
    );
  });

  it("applies limit defaults and bounds", () => {
    expect(ok({ limits: {} }).limits).toEqual({
      maxTurnsPerSession: 30,
      maxToolCallsPerTurn: 4,
      maxOutputTokens: 600,
    });
    const lim = (over: Record<string, unknown>) => bad({ limits: over }).success;
    expect(lim({ maxTurnsPerSession: 1 })).toBe(true);
    expect(lim({ maxTurnsPerSession: 100 })).toBe(true);
    expect(lim({ maxTurnsPerSession: 0 })).toBe(false);
    expect(lim({ maxTurnsPerSession: 101 })).toBe(false);
    expect(lim({ maxToolCallsPerTurn: 1 })).toBe(true);
    expect(lim({ maxToolCallsPerTurn: 6 })).toBe(true);
    expect(lim({ maxToolCallsPerTurn: 0 })).toBe(false);
    expect(lim({ maxToolCallsPerTurn: 7 })).toBe(false);
    expect(lim({ maxOutputTokens: 100 })).toBe(true);
    expect(lim({ maxOutputTokens: 2000 })).toBe(true);
    expect(lim({ maxOutputTokens: 99 })).toBe(false);
    expect(lim({ maxOutputTokens: 2001 })).toBe(false);
    expect(lim({ maxOutputTokens: 600.5 })).toBe(false);
  });

  it("accepts the two response styles only", () => {
    expect(ok({ responseStyle: "detailed" }).responseStyle).toBe("detailed");
    expect(bad({ responseStyle: "rambling" }).success).toBe(false);
  });

  it("keeps an optional model of at most 100 characters and omits a blank one", () => {
    expect(ok({ model: " gpt-test " }).model).toBe("gpt-test");
    expect(ok({ model: "a".repeat(100) }).model).toHaveLength(100);
    expect(bad({ model: "a".repeat(101) }).success).toBe(false);
    expect(ok({ model: "   " })).not.toHaveProperty("model");
    expect(ok()).not.toHaveProperty("model");
  });

  it("accepts the two statuses and rejects others", () => {
    expect(ok({ status: "active" }).status).toBe("active");
    expect(bad({ status: "paused" }).success).toBe(false);
  });

  it("never echoes the submitted value in error messages", () => {
    const secret = "SECRET-VALUE-123";
    const results = [
      bad({ name: secret.repeat(10) }),
      bad({ tools: [secret] }),
      bad({ languages: [secret] }),
      bad({ channels: [secret] }),
      bad({ productAccess: { mode: secret } }),
      bad({ responseStyle: secret }),
      bad({ role: secret }),
      bad({ status: secret }),
    ];
    for (const r of results) {
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues)).not.toContain(secret);
    }
  });
});

describe("agentPatchSchema", () => {
  it("parses a single field to exactly that field, with no defaults", () => {
    expect(patchOk({ name: "New name" })).toEqual({ name: "New name" });
    expect(patchOk({ responseStyle: "detailed" })).toEqual({ responseStyle: "detailed" });
  });

  it("rejects an empty patch and a patch of only unknown keys", () => {
    for (const input of [{}, { version: 3 }, { organizationId: "x", createdBy: "y" }]) {
      const r = patchBad(input);
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe("At least one field is required");
    }
  });

  it("strips managed keys alongside valid ones", () => {
    expect(
      patchOk({ name: "A", version: 9, organizationId: "x", createdBy: "y", nameLower: "z" }),
    ).toEqual({ name: "A" });
  });

  it("allows status changes", () => {
    expect(patchOk({ status: "active" })).toEqual({ status: "active" });
    expect(patchOk({ status: "inactive" })).toEqual({ status: "inactive" });
    expect(patchBad({ status: "paused" }).success).toBe(false);
  });

  it("applies the same bounds as create", () => {
    expect(patchBad({ name: "" }).success).toBe(false);
    expect(patchBad({ name: "a".repeat(81) }).success).toBe(false);
    expect(patchBad({ instructions: "a".repeat(8001) }).success).toBe(false);
    expect(patchBad({ tools: ["nope"] }).success).toBe(false);
    expect(patchBad({ languages: [] }).success).toBe(false);
    expect(patchBad({ productAccess: { mode: "categories", categoryIds: [] } }).success).toBe(
      false,
    );
    expect(patchBad({ limits: { maxToolCallsPerTurn: 99 } }).success).toBe(false);
  });

  it("requires the test channel when channels are patched", () => {
    expect(patchOk({ channels: ["test", "voice"] })).toEqual({ channels: ["test", "voice"] });
    expect(patchBad({ channels: ["whatsapp"] }).success).toBe(false);
    expect(patchBad({ channels: [] }).success).toBe(false);
  });

  it("clears the model override with null or a blank string", () => {
    expect(patchOk({ model: null })).toEqual({ model: null });
    expect(patchOk({ model: "  " })).toEqual({ model: null });
    expect(patchOk({ model: "gpt-x" })).toEqual({ model: "gpt-x" });
  });

  it("replaces nested objects wholesale (nested defaults only fill that object)", () => {
    expect(patchOk({ productAccess: { mode: "all" } })).toEqual({ productAccess: { mode: "all" } });
  });

  it("requires all three limits in a limits patch and never fills in defaults", () => {
    expect(patchBad({ limits: {} }).success).toBe(false);
    expect(patchBad({ limits: { maxTurnsPerSession: 10 } }).success).toBe(false);
    expect(patchBad({ limits: { maxTurnsPerSession: 10, maxToolCallsPerTurn: 2 } }).success).toBe(
      false,
    );
    const full = { maxTurnsPerSession: 10, maxToolCallsPerTurn: 2, maxOutputTokens: 300 };
    expect(patchOk({ limits: full })).toEqual({ limits: full });
  });

  it("replaces escalation wholesale, so omitting maxTurnsBeforeHandover clears it", () => {
    const out = patchOk({ escalation: { keywords: ["refund"], onMissingInfo: false } });
    expect(out).toEqual({ escalation: { keywords: ["refund"], onMissingInfo: false } });
    expect(out.escalation).not.toHaveProperty("maxTurnsBeforeHandover");
    expect(
      patchOk({
        escalation: { keywords: [], onMissingInfo: true, maxTurnsBeforeHandover: 5 },
      }).escalation?.maxTurnsBeforeHandover,
    ).toBe(5);
    expect(patchBad({ escalation: { keywords: [] } }).success).toBe(false);
  });

  it("allows the role to be changed but it is not a versioned field", () => {
    expect(patchOk({ role: "voice_sales" })).toEqual({ role: "voice_sales" });
    expect(patchOk({ name: "A", role: "customer_support" })).toEqual({
      name: "A",
      role: "customer_support",
    });
    const secret = "SECRET-ROLE-123";
    const r = patchBad({ role: secret });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).not.toContain(secret);
    expect(r.error?.issues[0]?.message).toBe("Choose a role");
    expect((VERSIONED_FIELDS as readonly string[]).includes("role")).toBe(false);
  });
});
