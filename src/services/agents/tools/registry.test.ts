import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { toStrictJsonSchema } from "@/lib/ai/strict-schema";
import {
  TOOL_NAMES,
  WRITE_TOOLS,
  agentInputSchema,
  type Agent,
  type ToolName,
} from "@/schemas/agent";

import { PRODUCT_LIST_INDEXES, toFirestoreIndex } from "@/services/products/product-indexes";

import { isProductInScope } from "./catalog-access";
import { TOOL_REGISTRY, executeTool, normalizeNulls, toolSpecsFor } from "./registry";
import { STOPWORDS, scoreFields, tokenize } from "./search-products";
import type { ToolContext } from "./types";

function makeAgent(over: Record<string, unknown> = {}): Agent {
  return {
    ...agentInputSchema.parse({ name: "Test agent", role: "retail_sales", ...over }),
    id: "agent-1",
    organizationId: "org-1",
    version: 1,
    createdBy: "uid-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeCtx(agent: Agent): ToolContext {
  return {
    organizationId: "org-1",
    agent,
    sessionId: "session-1",
    channel: "test",
    actorUid: "uid-1",
  };
}

const CATALOG: ToolName[] = [
  "search_products",
  "get_product_details",
  "get_price",
  "check_stock",
  "calculate_order_total",
];

interface StrictNode {
  type?: unknown;
  properties?: Record<string, StrictNode>;
  required?: string[];
  additionalProperties?: unknown;
  items?: StrictNode;
}

function assertStrictObjects(node: StrictNode): void {
  if (node.properties) {
    expect(node.additionalProperties).toBe(false);
    expect([...(node.required ?? [])].sort()).toEqual(Object.keys(node.properties).sort());
    for (const child of Object.values(node.properties)) assertStrictObjects(child);
  }
  if (node.items) assertStrictObjects(node.items);
}

describe("TOOL_REGISTRY", () => {
  it("registers every tool under its own name, and each converts to a strict schema", () => {
    expect(Object.keys(TOOL_REGISTRY).sort()).toEqual([...TOOL_NAMES].sort());
    for (const name of TOOL_NAMES) {
      const tool = TOOL_REGISTRY[name];
      expect(tool.name).toBe(name);
      const schema = toStrictJsonSchema(tool.input);
      expect(schema.type).toBe("object");
      assertStrictObjects(schema as StrictNode);
    }
    expect(TOOL_NAMES.filter((n) => TOOL_REGISTRY[n].writes).sort()).toEqual([
      "confirm_order",
      "create_draft_order",
      "escalate_to_human",
      "save_customer_info",
      "send_payment_link",
      "update_draft_order",
    ]);
    // The registry and WRITE_TOOLS agree on which tools write.
    expect(TOOL_NAMES.filter((n) => TOOL_REGISTRY[n].writes).sort()).toEqual(
      [...WRITE_TOOLS].sort(),
    );
  });

  it("registers the four order tools; only the status tool is read-only", () => {
    for (const name of [
      "create_draft_order",
      "update_draft_order",
      "confirm_order",
      "get_my_order_status",
    ] as const) {
      expect(TOOL_NAMES).toContain(name);
      expect(TOOL_REGISTRY[name].name).toBe(name);
      expect(TOOL_REGISTRY[name].description.length).toBeGreaterThan(20);
    }
    expect(WRITE_TOOLS.has("get_my_order_status")).toBe(false);
    expect(TOOL_REGISTRY.get_my_order_status.writes).toBe(false);
  });

  it("never takes a customer id or phone as an order tool argument", () => {
    for (const name of [
      "create_draft_order",
      "update_draft_order",
      "confirm_order",
      "get_my_order_status",
    ] as const) {
      const text = JSON.stringify(toStrictJsonSchema(TOOL_REGISTRY[name].input));
      expect(text).not.toMatch(/customerId|"phone"|phoneE164/);
    }
  });

  it("registers the five catalog tools, read-only, keyed by their own name", () => {
    for (const name of CATALOG) {
      const tool = TOOL_REGISTRY[name];
      expect(tool?.name).toBe(name);
      expect(tool?.writes).toBe(false);
      expect(tool?.description.length).toBeGreaterThan(20);
    }
    for (const key of Object.keys(TOOL_REGISTRY)) {
      expect(TOOL_NAMES as readonly string[]).toContain(key);
    }
  });
});

describe("toolSpecsFor", () => {
  it("emits only the agent's tools, with strict schemas", () => {
    const agent = makeAgent({ tools: ["search_products", "check_stock"] });
    const specs = toolSpecsFor(agent);
    expect(specs.map((s) => s.name)).toEqual(["search_products", "check_stock"]);
    for (const spec of specs) {
      expect(spec.description.length).toBeGreaterThan(20);
      expect(spec.parameters.type).toBe("object");
      assertStrictObjects(spec.parameters as StrictNode);
      expect(spec.parameters).not.toHaveProperty("$schema");
    }
  });

  it("makes optional inputs required and nullable (strict mode)", () => {
    const [spec] = toolSpecsFor(makeAgent({ tools: ["search_products"] }));
    const props = (spec?.parameters as { properties: Record<string, { type: unknown }> })
      .properties;
    expect(Object.keys(props).sort()).toEqual(["categoryId", "limit", "query"]);
    expect(props.categoryId?.type).toEqual(["string", "null"]);
  });

  it("emits nothing for an agent with no tools", () => {
    expect(toolSpecsFor(makeAgent({ tools: [] }))).toEqual([]);
  });

  it("includes the CRM tools when the agent has them", () => {
    const agent = makeAgent({ tools: ["lookup_customer", "get_price", "escalate_to_human"] });
    expect(toolSpecsFor(agent).map((s) => s.name)).toEqual([
      "lookup_customer",
      "get_price",
      "escalate_to_human",
    ]);
  });

  it("converts every registered tool to a strict schema", () => {
    const agent = makeAgent({ tools: [...TOOL_NAMES] });
    const specs = toolSpecsFor(agent);
    expect(specs.length).toBeGreaterThanOrEqual(CATALOG.length);
    for (const spec of specs) assertStrictObjects(spec.parameters as StrictNode);
  });
});

describe("normalizeNulls", () => {
  it("turns null into undefined recursively, in objects and arrays", () => {
    const out = normalizeNulls({ a: null, b: { c: null, d: 1 }, e: [{ f: null, g: 2 }] });
    expect(out).toEqual({ b: { d: 1 }, e: [{ g: 2 }] });
    expect("a" in (out as object)).toBe(false);
  });

  it("leaves other values alone and does not pollute prototypes", () => {
    const out = normalizeNulls(
      JSON.parse('{"__proto__":{"x":1},"n":0,"s":"","f":false}'),
    ) as Record<string, unknown>;
    expect(out.n).toBe(0);
    expect(out.s).toBe("");
    expect(out.f).toBe(false);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe("executeTool (paths that never reach the database)", () => {
  const agent = makeAgent({ tools: ["search_products"] });
  const ctx = makeCtx(agent);

  it("denies a tool that is not in agent.tools", async () => {
    const r = await executeTool(ctx, "get_price", "{}");
    expect(r).toEqual({
      ok: false,
      code: "denied",
      message: "That tool isn't available to this agent.",
    });
  });

  it("denies unknown names and prototype-ish names", async () => {
    for (const name of ["nope", "constructor", "__proto__", "toString", ""]) {
      const r = await executeTool(ctx, name, "{}");
      expect(r).toMatchObject({ ok: false, code: "denied" });
    }
  });

  it("validates order tool input before touching the database", async () => {
    const orders = makeCtx(
      makeAgent({ tools: ["create_draft_order", "confirm_order", "update_draft_order"] }),
    );
    const line = { productId: "p1", quantity: 1 };
    const address = { recipientName: "R", line1: "L", zone: "inside_dhaka" };
    for (const args of [
      {},
      { lines: [], address, paymentMethod: "cod" },
      { lines: Array.from({ length: 21 }, () => line), address, paymentMethod: "cod" },
      { lines: [{ ...line, quantity: 0 }], address, paymentMethod: "cod" },
      { lines: [line], address: { ...address, zone: "mars" }, paymentMethod: "cod" },
      { lines: [line], address, paymentMethod: "bkash" },
    ]) {
      expect(await executeTool(orders, "create_draft_order", JSON.stringify(args))).toMatchObject({
        ok: false,
        code: "invalid",
      });
    }
    for (const args of [
      {},
      { customerConfirmed: true },
      { customerConfirmed: true, confirmationQuote: "" },
      { customerConfirmed: true, confirmationQuote: "x".repeat(201) },
      { customerConfirmed: "yes", confirmationQuote: "yes" },
    ]) {
      expect(await executeTool(orders, "confirm_order", JSON.stringify(args))).toMatchObject({
        ok: false,
        code: "invalid",
      });
    }
    expect(
      await executeTool(orders, "update_draft_order", JSON.stringify({ phone: "01711000000" })),
    ).toMatchObject({ ok: false, code: "invalid" });
  });

  it("validates CRM tool input before touching the database", async () => {
    const crm = makeCtx(makeAgent({ tools: ["lookup_customer", "escalate_to_human"] }));
    expect(await executeTool(crm, "lookup_customer", "{}")).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await executeTool(crm, "escalate_to_human", '{"reason":""}')).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(
      await executeTool(crm, "escalate_to_human", `{"reason":"${"x".repeat(301)}"}`),
    ).toMatchObject({ ok: false, code: "invalid" });
  });

  it("denies when the agent belongs to another organization", async () => {
    const foreign = { ...ctx, organizationId: "org-2" };
    expect(await executeTool(foreign, "search_products", '{"query":"x"}')).toMatchObject({
      ok: false,
      code: "denied",
    });
  });

  it("treats malformed, truncated, empty and non-object JSON as invalid", async () => {
    for (const json of ["not json", '{"query":"sh', "", "[]", "null", '"x"', "42"]) {
      const r = await executeTool(ctx, "search_products", json);
      expect(r).toEqual({
        ok: false,
        code: "invalid",
        message: "The request to the tool was invalid.",
      });
    }
  });

  it("treats schema failures as invalid without echoing the arguments", async () => {
    for (const json of [
      "{}",
      '{"query":""}',
      '{"query":"   "}',
      '{"query":"!!!"}',
      `{"query":"${"x".repeat(101)}"}`,
      '{"query":"shirt","limit":6}',
      '{"query":"shirt","limit":0}',
      '{"query":"shirt","limit":1.5}',
      '{"query":"shirt","limit":"3"}',
      '{"query":"secret-marker","limit":99}',
    ]) {
      const r = await executeTool(ctx, "search_products", json);
      expect(r).toMatchObject({ ok: false, code: "invalid" });
      expect(JSON.stringify(r)).not.toContain("secret-marker");
    }
  });

  it("rejects absurdly deep or large arguments as invalid", async () => {
    const deep = `{"query":"a","x":${"[".repeat(500)}${"]".repeat(500)}}`;
    expect(await executeTool(ctx, "search_products", deep)).toMatchObject({ code: "invalid" });
    const big = JSON.stringify({ query: "a".repeat(200_000) });
    expect(await executeTool(ctx, "search_products", big)).toMatchObject({ code: "invalid" });
  });
});

describe("isProductInScope", () => {
  it("allows everything for mode all, and only listed categories otherwise", () => {
    const all = makeAgent();
    const some = makeAgent({ productAccess: { mode: "categories", categoryIds: ["cat-1"] } });
    expect(isProductInScope(all, {})).toBe(true);
    expect(isProductInScope(all, { categoryId: "cat-9" })).toBe(true);
    expect(isProductInScope(some, { categoryId: "cat-1" })).toBe(true);
    expect(isProductInScope(some, { categoryId: "cat-2" })).toBe(false);
    expect(isProductInScope(some, {})).toBe(false);
  });
});

describe("tokenize and scoreFields", () => {
  it("lower-cases, applies NFKC and splits on punctuation", () => {
    expect(tokenize("Red-Cotton  SHIRT (XL)")).toEqual(["red", "cotton", "shirt", "xl"]);
    expect(tokenize("ＳＨＩＲＴ")).toEqual(["shirt"]);
    expect(tokenize("  ")).toEqual([]);
    expect(tokenize("!!!")).toEqual([]);
  });

  it("keeps Bangla words whole (vowel signs and conjuncts are not separators)", () => {
    expect(tokenize("লাল শার্ট, পাঞ্জাবি।")).toEqual(["লাল", "শার্ট", "পাঞ্জাবি"]);
  });

  const fields = {
    name: tokenize("Red Cotton Shirt"),
    sku: tokenize("TEE-001"),
    category: tokenize("Apparel"),
    spec: tokenize("Cotton Regular"),
  };

  it("matches when at least one query token matches, and not at all otherwise", () => {
    expect(scoreFields(tokenize("lal shirt"), fields)).toBeGreaterThan(0);
    expect(scoreFields(tokenize("xyzzy"), fields)).toBe(0);
    expect(scoreFields(tokenize("xyzzy plugh"), fields)).toBe(0);
    expect(scoreFields([], fields)).toBe(0);
  });

  it("ranks more matched tokens above a stronger field with fewer matches", () => {
    const q = ["red", "cotton"];
    const empty = { name: [] as string[], sku: [] as string[], category: [] as string[] };
    const two = scoreFields(q, { ...empty, spec: ["red", "cotton"] });
    const one = scoreFields(q, { ...empty, name: ["red"], spec: [] });
    expect(two).toBeGreaterThan(one);
  });

  it("matches plurals and inflections in the reverse direction, at a small penalty", () => {
    const f = (name: string[]) => ({ name, sku: [], category: [], spec: [] });
    const exact = scoreFields(["shirt"], f(["shirt"]));
    const plural = scoreFields(["shirts"], f(["shirt"]));
    expect(plural).toBeGreaterThan(0);
    expect(plural).toBeLessThan(exact);
    expect(scoreFields(tokenize("শার্টের"), f(tokenize("লাল শার্ট")))).toBeGreaterThan(0);
    // Short field tokens never match in reverse ("a" is not a stem of "apple").
    expect(scoreFields(["apple"], f(["a"]))).toBe(0);
    expect(scoreFields(["bnx"], f(["bn"]))).toBe(0);
  });

  it("lets 1-2 character query tokens match only exactly (no prefix either way)", () => {
    const f = (spec: string[]) => ({
      name: [] as string[],
      sku: [] as string[],
      category: [] as string[],
      spec,
    });
    expect(scoreFields(["xl"], f(["xl"]))).toBeGreaterThan(0);
    expect(scoreFields(["xl"], f(["xlarge"]))).toBe(0);
    expect(scoreFields(["m"], f(["m", "l"]))).toBeGreaterThan(0);
    expect(scoreFields(["a"], f(["apple"]))).toBe(0);
    expect(scoreFields(["do"], f(["dot"]))).toBe(0);
  });

  it("drops filler words from scoring, unless the query is only filler", () => {
    const f = (name: string[]) => ({
      name,
      sku: [] as string[],
      category: [] as string[],
      spec: [] as string[],
    });
    expect(scoreFields(tokenize("do you have a red shirt"), f(["young", "dot", "apple"]))).toBe(0);
    const real = scoreFields(tokenize("do you have a red shirt"), f(["red", "shirt"]));
    expect(real).toBe(scoreFields(tokenize("red shirt"), f(["red", "shirt"])));
    // Only filler: scored normally ("you" prefix-matches "young").
    expect(scoreFields(tokenize("do you have"), f(["young"]))).toBeGreaterThan(0);
    expect(scoreFields(tokenize("do you have"), f(["red"]))).toBe(0);
    expect(scoreFields(tokenize("lal shirt ache"), f(["red", "shirt"]))).toBe(
      scoreFields(tokenize("lal shirt"), f(["red", "shirt"])),
    );
    // Bangla-script filler words (escapes keep this file free of invisible characters).
    expect(STOPWORDS.has(tokenize("আছে")[0]!)).toBe(true);
  });

  it("matches token prefixes, not substrings", () => {
    expect(scoreFields(tokenize("shi"), fields)).toBeGreaterThan(0);
    expect(scoreFields(tokenize("hirt"), fields)).toBe(0);
  });

  it("ranks name above sku above category above specifications", () => {
    const only = (key: "name" | "sku" | "category" | "spec") => ({
      name: [] as string[],
      sku: [] as string[],
      category: [] as string[],
      spec: [] as string[],
      [key]: ["x"],
    });
    const s = (key: "name" | "sku" | "category" | "spec") => scoreFields(["x"], only(key));
    expect(s("name")).toBeGreaterThan(s("sku"));
    expect(s("sku")).toBeGreaterThan(s("category"));
    expect(s("category")).toBeGreaterThan(s("spec"));
    expect(s("spec")).toBeGreaterThan(0);
  });

  it("scores an exact token above a prefix of the same field", () => {
    const exact = scoreFields(["shirt"], { name: ["shirt"], sku: [], category: [], spec: [] });
    const prefix = scoreFields(["shirt"], { name: ["shirts"], sku: [], category: [], spec: [] });
    expect(exact).toBeGreaterThan(prefix);
  });
});

describe("search_products query index", () => {
  it("is served by the products index (organizationId, archived, availability, nameLower)", () => {
    const spec = PRODUCT_LIST_INDEXES.find(
      (i) =>
        i.equalityField === "availability" &&
        i.orderField === "nameLower" &&
        i.direction === "ASCENDING",
    );
    expect(spec).toBeDefined();
    const file = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, "../../../../firestore.indexes.json"), "utf8"),
    ) as { indexes: unknown[] };
    const wanted = JSON.stringify(toFirestoreIndex(spec!));
    expect(file.indexes.map((i) => JSON.stringify(i))).toContain(wanted);
    expect(toFirestoreIndex(spec!).fields.map((f) => f.fieldPath)).toEqual([
      "organizationId",
      "archived",
      "availability",
      "nameLower",
      "__name__",
    ]);
  });
});
