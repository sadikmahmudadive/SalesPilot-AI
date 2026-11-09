import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { LOW_STOCK_THRESHOLD } from "@/config/inventory";
import { adminDb } from "@/lib/firebase/admin";
import { formatMoneyMinor } from "@/lib/format";
import { agentInputSchema, type Agent } from "@/schemas/agent";
import { categoryInputSchema, productInputSchema } from "@/schemas/product";
import { adjustStock } from "@/services/inventory/stock";
import { createCategory } from "@/services/products/categories";
import { archiveProduct, createProduct } from "@/services/products/products";

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
      tools: [
        "search_products",
        "get_product_details",
        "get_price",
        "check_stock",
        "calculate_order_total",
      ],
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

function toolCtx(agent: Agent): ToolContext {
  return {
    organizationId: agent.organizationId,
    agent,
    sessionId: "session-1",
    channel: "test",
    actorUid: "uid-seed",
  };
}

async function run(agent: Agent, name: string, args: unknown): Promise<ToolOutcome<unknown>> {
  return executeTool(toolCtx(agent), name, JSON.stringify(args));
}

function okData<T = Record<string, unknown>>(r: ToolOutcome<unknown>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
  return r.data as T;
}

interface SearchData {
  results: Array<Record<string, unknown> & { productId: string; name: string }>;
}
const searchIds = async (agent: Agent, args: Record<string, unknown>) =>
  okData<SearchData>(await run(agent, "search_products", args)).results.map((p) => p.productId);

// Seeded catalogue ----------------------------------------------------------------------------
interface Seed {
  apparel: string;
  electronics: string;
  shirt: string; // active, apparel, variants M (10) and L (3), sale + wholesale prices
  shirtM: string;
  shirtL: string;
  bangla: string; // active, apparel, no variants, stock 5, no sale / wholesale price
  speaker: string; // active, electronics, no variants, stock 6
  mug: string; // active, electronics, no variants, no stock
  hoodie: string; // draft, apparel
  cap: string; // archived, apparel
  foreignShirt: string; // another organization
}
let seed: Seed;

const unitCtx = (org: string) => ctxOf(org);

async function stock(org: string, productId: string, variantId: string, qty: number) {
  await adjustStock(unitCtx(org), productId, variantId, { delta: qty, reason: "test seed" });
}

beforeAll(async () => {
  const c = ctxOf(ORG);
  const apparel = await createCategory(c, categoryInputSchema.parse({ name: "Apparel" }));
  const electronics = await createCategory(c, categoryInputSchema.parse({ name: "Electronics" }));

  const shirt = await createProduct(
    c,
    productInputSchema.parse({
      name: "Red Cotton Shirt",
      sku: "tee-001",
      description: "A soft shirt. " + "x".repeat(2500),
      categoryId: apparel.id,
      regularPriceMinor: 150000,
      salePriceMinor: 120000,
      wholesalePriceMinor: 100000,
      availability: "active",
      variants: [
        { size: "M", color: "Red" },
        { size: "L", color: "Red" },
      ],
      specifications: { Fabric: "Cotton", Fit: "Regular" },
      faqs: [{ q: "Does it shrink?", a: "Not after the first wash." }],
    }),
  );
  const [shirtM, shirtL] = shirt.variants.map((v) => v.id) as [string, string];
  await stock(ORG, shirt.id, shirtM, 10);
  await stock(ORG, shirt.id, shirtL, 3);

  const bangla = await createProduct(
    c,
    productInputSchema.parse({
      name: "লাল শার্ট",
      sku: "BN-100",
      categoryId: apparel.id,
      regularPriceMinor: 99900,
      availability: "active",
    }),
  );
  await stock(ORG, bangla.id, "default", LOW_STOCK_THRESHOLD);

  const speaker = await createProduct(
    c,
    productInputSchema.parse({
      name: "Bluetooth Speaker",
      sku: "SPK-200",
      categoryId: electronics.id,
      regularPriceMinor: 250000,
      availability: "active",
      specifications: { Brand: "Sonic" },
    }),
  );
  await stock(ORG, speaker.id, "default", LOW_STOCK_THRESHOLD + 1);

  const mug = await createProduct(
    c,
    productInputSchema.parse({
      name: "Zero Mug",
      sku: "MUG-1",
      categoryId: electronics.id,
      regularPriceMinor: 5000,
      availability: "active",
    }),
  );

  const hoodie = await createProduct(
    c,
    productInputSchema.parse({
      name: "Draft Hoodie",
      sku: "HOOD-1",
      categoryId: apparel.id,
      regularPriceMinor: 300000,
      availability: "draft",
    }),
  );
  await stock(ORG, hoodie.id, "default", 50);

  const cap = await createProduct(
    c,
    productInputSchema.parse({
      name: "Archived Cap",
      sku: "CAP-1",
      categoryId: apparel.id,
      regularPriceMinor: 80000,
      availability: "active",
    }),
  );
  await stock(ORG, cap.id, "default", 50);
  await archiveProduct(c, cap.id);

  const foreignCat = await createCategory(
    ctxOf(OTHER_ORG),
    categoryInputSchema.parse({ name: "Apparel" }),
  );
  const foreignShirt = await createProduct(
    ctxOf(OTHER_ORG),
    productInputSchema.parse({
      name: "Red Cotton Shirt",
      sku: "tee-001",
      categoryId: foreignCat.id,
      regularPriceMinor: 1,
      availability: "active",
    }),
  );

  seed = {
    apparel: apparel.id,
    electronics: electronics.id,
    shirt: shirt.id,
    shirtM,
    shirtL,
    bangla: bangla.id,
    speaker: speaker.id,
    mug: mug.id,
    hoodie: hoodie.id,
    cap: cap.id,
    foreignShirt: foreignShirt.id,
  };
}, 120_000);

afterAll(async () => {
  const collections = [
    "products",
    "productSkus",
    "productSlugs",
    "inventory",
    "categories",
    "categoryNames",
    "auditLogs",
  ];
  await Promise.all(
    orgs.flatMap((org) =>
      collections.map(async (col) => {
        const snap = await adminDb().collection(col).where("organizationId", "==", org).get();
        await Promise.all(snap.docs.map((d) => adminDb().recursiveDelete(d.ref)));
      }),
    ),
  );
}, 120_000);

const all = () => makeAgent(ORG);
const apparelOnly = () =>
  makeAgent(ORG, { productAccess: { mode: "categories", categoryIds: [seed.apparel] } });
const electronicsOnly = () =>
  makeAgent(ORG, { productAccess: { mode: "categories", categoryIds: [seed.electronics] } });

const NOT_FOUND = {
  ok: false,
  code: "not_found",
  message: "That product isn't available.",
} as const;

describe("search_products", () => {
  it("finds by an English name token, case-insensitively", async () => {
    expect(await searchIds(all(), { query: "SHIRT" })).toContain(seed.shirt);
    expect(await searchIds(all(), { query: "cotton" })).toEqual([seed.shirt]);
  });

  it("finds by SKU (prefix and the full SKU)", async () => {
    expect(await searchIds(all(), { query: "tee" })).toEqual([seed.shirt]);
    expect(await searchIds(all(), { query: "TEE-001" })).toEqual([seed.shirt]);
    expect(await searchIds(all(), { query: "bn-1" })).toEqual([seed.bangla]);
  });

  it("finds a Bangla product by a Bangla name token", async () => {
    expect(await searchIds(all(), { query: "শার্ট" })).toEqual([seed.bangla]);
    expect(await searchIds(all(), { query: "লাল" })).toEqual([seed.bangla]);
  });

  it("finds by category name and by specification value", async () => {
    expect((await searchIds(all(), { query: "electronics" })).sort()).toEqual(
      [seed.speaker, seed.mug].sort(),
    );
    expect(await searchIds(all(), { query: "sonic" })).toEqual([seed.speaker]);
  });

  it("returns an empty result (not an error) for a query that matches nothing", async () => {
    const r = await run(all(), "search_products", { query: "lal shirt" });
    expect(r).toEqual({ ok: true, data: { results: [] } });
  });

  it("breaks score ties by product name", async () => {
    // Both match "electronics" only through the category name, so the name order decides.
    expect(await searchIds(all(), { query: "electronics" })).toEqual([seed.speaker, seed.mug]);
  });

  it("returns compact items without internal fields", async () => {
    const [item] = okData<SearchData>(
      await run(all(), "search_products", { query: "tee-001" }),
    ).results;
    expect(item).toEqual({
      productId: seed.shirt,
      name: "Red Cotton Shirt",
      sku: "TEE-001",
      priceText: formatMoneyMinor(120000),
      availability: "active",
      stockStatus: "in_stock",
    });
  });

  it("reports stock status from the inventory (low, in stock, out of stock)", async () => {
    const results = okData<SearchData>(await run(all(), "search_products", { query: "bn-100" }));
    expect(results.results[0]?.stockStatus).toBe("low");
    const speaker = okData<SearchData>(await run(all(), "search_products", { query: "spk" }));
    expect(speaker.results[0]?.stockStatus).toBe("in_stock");
    const mug = okData<SearchData>(await run(all(), "search_products", { query: "mug" }));
    expect(mug.results[0]?.stockStatus).toBe("out_of_stock");
  });

  it("never returns products outside the agent's categories", async () => {
    expect(await searchIds(apparelOnly(), { query: "speaker" })).toEqual([]);
    expect(await searchIds(apparelOnly(), { query: "electronics" })).toEqual([]);
    expect(await searchIds(electronicsOnly(), { query: "shirt" })).toEqual([]);
    expect(await searchIds(electronicsOnly(), { query: "speaker" })).toEqual([seed.speaker]);
  });

  it("never returns draft or archived products", async () => {
    expect(await searchIds(all(), { query: "hoodie" })).toEqual([]);
    expect(await searchIds(all(), { query: "cap" })).toEqual([]);
    expect(await searchIds(all(), { query: "draft" })).toEqual([]);
  });

  it("never returns another organization's products", async () => {
    const ids = await searchIds(all(), { query: "shirt" });
    expect(ids).not.toContain(seed.foreignShirt);
    const foreignAgent = makeAgent(OTHER_ORG);
    const foreign = await searchIds(foreignAgent, { query: "shirt" });
    expect(foreign).toEqual([seed.foreignShirt]);
  });

  it("honours the optional categoryId filter and the limit", async () => {
    const inCat = await searchIds(all(), { query: "e", categoryId: seed.electronics });
    expect(inCat.sort()).toEqual([seed.speaker, seed.mug].sort());
    expect(
      await searchIds(all(), { query: "e", categoryId: seed.electronics, limit: 1 }),
    ).toHaveLength(1);
    expect(await searchIds(all(), { query: "e", categoryId: "nope" })).toEqual([]);
  });

  it("accepts null for omitted optional arguments (strict mode)", async () => {
    const r = await executeTool(
      toolCtx(all()),
      "search_products",
      '{"query":"cotton","categoryId":null,"limit":null}',
    );
    expect(okData<SearchData>(r).results.map((p) => p.productId)).toEqual([seed.shirt]);
  });

  it("rejects an empty or whitespace-only query and a limit above 5 as invalid", async () => {
    for (const args of [{ query: "" }, { query: "   " }, { query: "a", limit: 6 }]) {
      expect(await run(all(), "search_products", args)).toMatchObject({
        ok: false,
        code: "invalid",
      });
    }
  });
});

describe("get_product_details", () => {
  it("returns description, variants, specifications and FAQs without internal fields", async () => {
    const data = okData<Record<string, unknown>>(
      await run(all(), "get_product_details", { productId: seed.shirt }),
    );
    expect(data).toMatchObject({
      productId: seed.shirt,
      name: "Red Cotton Shirt",
      sku: "TEE-001",
      category: "Apparel",
      priceText: formatMoneyMinor(120000),
      variants: [
        { id: seed.shirtM, size: "M", color: "Red" },
        { id: seed.shirtL, size: "L", color: "Red" },
      ],
      specifications: [
        { name: "Fabric", value: "Cotton" },
        { name: "Fit", value: "Regular" },
      ],
      faqs: [{ q: "Does it shrink?", a: "Not after the first wash." }],
    });
    expect((data.description as string).length).toBeLessThanOrEqual(2000);
    const json = JSON.stringify(data);
    for (const internal of ["organizationId", "nameLower", "skuLower", "publicId", ORG]) {
      expect(json).not.toContain(internal);
    }
  });

  it("returns not_found, with no product data, for an out-of-scope product", async () => {
    const r = await run(electronicsOnly(), "get_product_details", { productId: seed.shirt });
    expect(r).toEqual(NOT_FOUND);
    expect(JSON.stringify(r)).not.toContain("Shirt");
  });

  it("treats draft, archived, missing, malformed and foreign ids as the same not_found", async () => {
    for (const productId of [
      seed.hoodie,
      seed.cap,
      "does-not-exist",
      "../x",
      "a/b",
      seed.foreignShirt,
    ]) {
      expect(await run(all(), "get_product_details", { productId })).toEqual(NOT_FOUND);
    }
  });

  it("caps specifications at 20 and FAQs at 10", async () => {
    const specs = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`S${i}`, `v${i}`]));
    const faqs = Array.from({ length: 15 }, (_, i) => ({ q: `Q${i}`, a: `A${i}` }));
    const p = await createProduct(
      ctxOf(ORG),
      productInputSchema.parse({
        name: "Spec Heavy",
        sku: "HEAVY-1",
        regularPriceMinor: 100,
        availability: "active",
        specifications: specs,
        faqs,
      }),
    );
    const data = okData<{ specifications: unknown[]; faqs: unknown[] }>(
      await run(all(), "get_product_details", { productId: p.id }),
    );
    expect(data.specifications).toHaveLength(20);
    expect(data.faqs).toHaveLength(10);
  });
});

describe("get_price", () => {
  it("gives the sale price as the effective retail price", async () => {
    const data = okData(
      await run(all(), "get_price", { productId: seed.shirt, customerType: "retail" }),
    );
    expect(data).toEqual({
      productId: seed.shirt,
      customerType: "retail",
      priceMinor: 150000,
      salePriceMinor: 120000,
      effectiveMinor: 120000,
      priceText: formatMoneyMinor(120000),
    });
  });

  it("uses the regular price when there is no sale price", async () => {
    const data = okData(
      await run(all(), "get_price", { productId: seed.bangla, customerType: "retail" }),
    );
    expect(data).toEqual({
      productId: seed.bangla,
      customerType: "retail",
      priceMinor: 99900,
      effectiveMinor: 99900,
      priceText: formatMoneyMinor(99900),
    });
  });

  it("uses the wholesale price for wholesale customers", async () => {
    const data = okData(
      await run(all(), "get_price", { productId: seed.shirt, customerType: "wholesale" }),
    );
    expect(data).toEqual({
      productId: seed.shirt,
      customerType: "wholesale",
      priceMinor: 100000,
      effectiveMinor: 100000,
      priceText: formatMoneyMinor(100000),
    });
  });

  it("flags the retail fallback when there is no wholesale price", async () => {
    const data = okData(
      await run(all(), "get_price", { productId: seed.bangla, customerType: "wholesale" }),
    );
    expect(data).toMatchObject({
      customerType: "wholesale",
      priceMinor: 99900,
      effectiveMinor: 99900,
      wholesaleFallback: true,
    });
  });

  it("validates the variant and accepts null for it", async () => {
    const ok = await executeTool(
      toolCtx(all()),
      "get_price",
      JSON.stringify({ productId: seed.shirt, variantId: seed.shirtM, customerType: "retail" }),
    );
    expect(ok.ok).toBe(true);
    const nul = await executeTool(
      toolCtx(all()),
      "get_price",
      JSON.stringify({ productId: seed.shirt, variantId: null, customerType: "retail" }),
    );
    expect(nul.ok).toBe(true);
    const bad = await run(all(), "get_price", {
      productId: seed.shirt,
      variantId: "nope",
      customerType: "retail",
    });
    expect(bad).toMatchObject({ ok: false, code: "not_found" });
  });

  it("returns not_found for out-of-scope, draft and archived products", async () => {
    for (const [agent, productId] of [
      [electronicsOnly(), seed.shirt],
      [all(), seed.hoodie],
      [all(), seed.cap],
    ] as const) {
      expect(await run(agent, "get_price", { productId, customerType: "retail" })).toEqual(
        NOT_FOUND,
      );
    }
  });

  it("rejects an unknown customer type as invalid", async () => {
    expect(
      await run(all(), "get_price", { productId: seed.shirt, customerType: "vip" }),
    ).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("check_stock", () => {
  it("classifies out_of_stock, low (up to the threshold) and in_stock", async () => {
    const check = async (productId: string, variantId?: string) =>
      okData(await run(all(), "check_stock", { productId, variantId }));
    expect(await check(seed.mug)).toMatchObject({ status: "out_of_stock", available: 0 });
    expect(await check(seed.bangla)).toMatchObject({ status: "low", available: 5 });
    expect(await check(seed.speaker)).toMatchObject({ status: "in_stock", available: 6 });
    expect(await check(seed.shirt, seed.shirtL)).toMatchObject({ status: "low", available: 3 });
    expect(await check(seed.shirt, seed.shirtM)).toMatchObject({
      status: "in_stock",
      available: 10,
    });
  });

  it("sums the variants when no variant is given", async () => {
    expect(okData(await run(all(), "check_stock", { productId: seed.shirt }))).toMatchObject({
      status: "in_stock",
      available: 13,
    });
  });

  it("returns not_found for unknown variants and unavailable products", async () => {
    expect(
      await run(all(), "check_stock", { productId: seed.shirt, variantId: "nope" }),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await run(all(), "check_stock", { productId: seed.bangla, variantId: "m" }),
    ).toMatchObject({ ok: false, code: "not_found" });
    for (const [agent, productId] of [
      [electronicsOnly(), seed.shirt],
      [all(), seed.hoodie],
      [all(), seed.cap],
      [all(), seed.foreignShirt],
    ] as const) {
      expect(await run(agent, "check_stock", { productId })).toEqual(NOT_FOUND);
    }
  });
});

describe("calculate_order_total", () => {
  interface Line {
    productId: string;
    variantId?: string;
    quantity: number;
    unitMinor?: number;
    lineMinor?: number;
    lineText?: string;
    flag?: string;
    name?: string;
    wholesaleFallback?: boolean;
    available?: number;
  }
  interface Total {
    customerType: string;
    lines: Line[];
    subtotalMinor: number;
    subtotalText: string;
    excludedLines: number;
    deliveryNote: string;
  }
  const total = async (agent: Agent, items: unknown[], customerType = "retail") =>
    okData<Total>(await run(agent, "calculate_order_total", { items, customerType }));

  it("computes exact retail line totals and subtotal in paisa and taka text", async () => {
    const t = await total(all(), [
      { productId: seed.shirt, variantId: seed.shirtM, quantity: 3 },
      { productId: seed.speaker, quantity: 2 },
    ]);
    expect(t.lines[0]).toMatchObject({ unitMinor: 120000, lineMinor: 360000 });
    expect(t.lines[1]).toMatchObject({ unitMinor: 250000, lineMinor: 500000 });
    expect(t.subtotalMinor).toBe(860000);
    expect(t.subtotalText).toBe(formatMoneyMinor(860000));
    expect(t.excludedLines).toBe(0);
    expect(t.deliveryNote).toBe("Delivery charges are not available yet.");
  });

  it("uses wholesale prices, flagging the retail fallback per line", async () => {
    const t = await total(
      all(),
      [
        { productId: seed.shirt, variantId: seed.shirtM, quantity: 2 },
        { productId: seed.bangla, quantity: 1 },
      ],
      "wholesale",
    );
    expect(t.lines[0]).toMatchObject({ unitMinor: 100000, lineMinor: 200000 });
    expect(t.lines[0]?.wholesaleFallback).toBeUndefined();
    expect(t.lines[1]).toMatchObject({
      unitMinor: 99900,
      lineMinor: 99900,
      wholesaleFallback: true,
    });
    expect(t.subtotalMinor).toBe(299900);
  });

  it("flags insufficient stock and excludes the line from the subtotal", async () => {
    const t = await total(all(), [
      { productId: seed.shirt, variantId: seed.shirtL, quantity: 4 },
      { productId: seed.bangla, quantity: 5 },
      { productId: seed.mug, quantity: 1 },
    ]);
    expect(t.lines[0]).toMatchObject({ flag: "insufficient_stock", available: 3 });
    expect(t.lines[0]?.lineMinor).toBeUndefined();
    expect(t.lines[1]?.flag).toBeUndefined();
    expect(t.lines[1]?.lineMinor).toBe(499500);
    expect(t.lines[2]).toMatchObject({ flag: "insufficient_stock", available: 0 });
    expect(t.subtotalMinor).toBe(499500);
    expect(t.excludedLines).toBe(2);
  });

  it("counts repeated lines of the same unit against the same stock", async () => {
    const t = await total(all(), [
      { productId: seed.shirt, variantId: seed.shirtL, quantity: 2 },
      { productId: seed.shirt, variantId: seed.shirtL, quantity: 2 },
    ]);
    expect(t.lines[0]?.flag).toBeUndefined();
    expect(t.lines[1]?.flag).toBe("insufficient_stock");
    expect(t.subtotalMinor).toBe(240000);
    expect(t.excludedLines).toBe(1);
  });

  it("flags out-of-scope, draft, archived, missing and foreign lines without data", async () => {
    const t = await total(electronicsOnly(), [
      { productId: seed.shirt, quantity: 1 },
      { productId: seed.speaker, quantity: 1 },
      { productId: seed.hoodie, quantity: 1 },
      { productId: seed.foreignShirt, quantity: 1 },
      { productId: "missing", quantity: 1 },
    ]);
    expect(t.lines.map((l) => l.flag)).toEqual([
      "out_of_scope",
      undefined,
      "out_of_scope",
      "out_of_scope",
      "out_of_scope",
    ]);
    for (const l of [t.lines[0], t.lines[2], t.lines[3], t.lines[4]]) {
      expect(l?.name).toBeUndefined();
      expect(l?.unitMinor).toBeUndefined();
    }
    expect(t.subtotalMinor).toBe(250000);
    expect(t.excludedLines).toBe(4);
  });

  it("flags draft and archived products that are in scope as archived", async () => {
    const t = await total(all(), [
      { productId: seed.hoodie, quantity: 1 },
      { productId: seed.cap, quantity: 1 },
    ]);
    expect(t.lines.map((l) => l.flag)).toEqual(["archived", "archived"]);
    expect(t.subtotalMinor).toBe(0);
    expect(t.subtotalText).toBe(formatMoneyMinor(0));
    expect(t.excludedLines).toBe(2);
  });

  it("flags a missing or unknown variant", async () => {
    const t = await total(all(), [
      { productId: seed.shirt, quantity: 1 },
      { productId: seed.shirt, variantId: "nope", quantity: 1 },
      { productId: seed.speaker, variantId: "m", quantity: 1 },
    ]);
    expect(t.lines.map((l) => l.flag)).toEqual([
      "invalid_variant",
      "invalid_variant",
      "invalid_variant",
    ]);
    expect(t.subtotalMinor).toBe(0);
  });

  it("accepts null for omitted variants (strict mode)", async () => {
    const r = await executeTool(
      toolCtx(all()),
      "calculate_order_total",
      JSON.stringify({
        items: [{ productId: seed.speaker, variantId: null, quantity: 1 }],
        customerType: "retail",
      }),
    );
    expect(okData<Total>(r).subtotalMinor).toBe(250000);
  });

  it("does not overflow with the largest allowed quantities and prices", async () => {
    const p = await createProduct(
      ctxOf(ORG),
      productInputSchema.parse({
        name: "Priciest",
        sku: "MAX-1",
        regularPriceMinor: 1_000_000_000,
        availability: "active",
      }),
    );
    await stock(ORG, p.id, "default", 1000);
    const t = await total(all(), [{ productId: p.id, quantity: 1 }]);
    expect(t.subtotalMinor).toBe(1_000_000_000);
    const big = await total(all(), [{ productId: p.id, quantity: 1000 }]);
    expect(big.subtotalMinor).toBe(1_000_000_000_000);
    expect(Number.isSafeInteger(big.subtotalMinor)).toBe(true);
  });

  it("rejects more than 20 lines, bad quantities and bad shapes as invalid", async () => {
    const line = { productId: seed.speaker, quantity: 1 };
    const cases: unknown[] = [
      { items: Array.from({ length: 21 }, () => line), customerType: "retail" },
      { items: [], customerType: "retail" },
      { items: [{ ...line, quantity: 1001 }], customerType: "retail" },
      { items: [{ ...line, quantity: 0 }], customerType: "retail" },
      { items: [{ ...line, quantity: 1.5 }], customerType: "retail" },
      { items: [{ ...line, quantity: -1 }], customerType: "retail" },
      { items: [line], customerType: "vip" },
      { items: [line] },
      {},
    ];
    for (const args of cases) {
      expect(await run(all(), "calculate_order_total", args)).toEqual({
        ok: false,
        code: "invalid",
        message: "The request to the tool was invalid.",
      });
    }
    const twenty = await run(all(), "calculate_order_total", {
      items: Array.from({ length: 20 }, () => line),
      customerType: "retail",
    });
    expect(twenty.ok).toBe(true);
  });
});

describe("executeTool", () => {
  it("denies a tool that is not in agent.tools", async () => {
    const limited = makeAgent(ORG, { tools: ["search_products"] });
    const r = await run(limited, "get_price", { productId: seed.shirt, customerType: "retail" });
    expect(r).toEqual({
      ok: false,
      code: "denied",
      message: "That tool isn't available to this agent.",
    });
  });

  it("returns invalid for malformed or truncated JSON", async () => {
    const r = await executeTool(toolCtx(all()), "search_products", '{"query":"shi');
    expect(r).toMatchObject({ ok: false, code: "invalid" });
  });

  it("turns a thrown error into a static failed result and logs only the tool and code", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const broken: ToolContext = { ...toolCtx(all()), organizationId: "bad/org" };
      broken.agent = { ...broken.agent, organizationId: "bad/org" };
      const r = await executeTool(broken, "search_products", '{"query":"secret-marker"}');
      expect(r).toEqual({
        ok: false,
        code: "failed",
        message: "The tool failed. Offer to connect the customer with a person.",
      });
      expect(spy).toHaveBeenCalledTimes(1);
      const line = String(spy.mock.calls[0]?.[0]);
      expect(line).toContain("search_products");
      expect(line).not.toContain("secret-marker");
      expect(line).not.toContain("bad/org");
    } finally {
      spy.mockRestore();
    }
  });
});
