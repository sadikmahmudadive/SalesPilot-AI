import { describe, expect, it } from "vitest";

import { AGENT_ROLES, TOOL_NAMES, WRITE_TOOLS, agentInputSchema } from "@/schemas/agent";

import { AGENT_TEMPLATES } from "./templates";

const KNOWN_TOOLS: ReadonlySet<string> = new Set(TOOL_NAMES);
// Bangla block U+0980-U+09FF, built from code points so this file stays ASCII.
const BANGLA = new RegExp(`[${String.fromCodePoint(0x0980)}-${String.fromCodePoint(0x09ff)}]`, "u");

describe("AGENT_TEMPLATES", () => {
  it("has exactly one template per role", () => {
    expect(Object.keys(AGENT_TEMPLATES).sort()).toEqual([...AGENT_ROLES].sort());
  });

  for (const role of AGENT_ROLES) {
    describe(role, () => {
      const t = AGENT_TEMPLATES[role];

      it("parses with the agent input schema once a name is added", () => {
        const r = agentInputSchema.safeParse({ ...t, name: "Template agent", role });
        expect(r.success).toBe(true);
      });

      it("only lists known tools, without duplicates", () => {
        expect(t.tools.length).toBeGreaterThan(0);
        for (const tool of t.tools) expect(KNOWN_TOOLS.has(tool)).toBe(true);
        expect(new Set(t.tools).size).toBe(t.tools.length);
      });

      it("grounds on tools and offers a human when unsure", () => {
        const text = t.instructions.toLowerCase();
        expect(text).toContain("tool");
        expect(text).toContain("human");
        expect(t.tools).toContain("escalate_to_human");
      });

      it("includes short Bangla example phrases", () => {
        expect(BANGLA.test(t.instructions)).toBe(true);
      });

      it("has a description, personality and objectives", () => {
        expect(t.description.length).toBeGreaterThan(0);
        expect(t.personality.length).toBeGreaterThan(0);
        expect(t.objectives.length).toBeGreaterThan(0);
      });
    });
  }

  it("lets sales roles look up prices and stock through tools", () => {
    for (const role of ["retail_sales", "wholesale_sales", "voice_sales"] as const) {
      expect(AGENT_TEMPLATES[role].tools).toEqual(
        expect.arrayContaining(["search_products", "get_price", "check_stock"]),
      );
    }
  });

  it("gives wholesale an order calculator and tells it to use wholesale prices", () => {
    expect(AGENT_TEMPLATES.wholesale_sales.tools).toContain("calculate_order_total");
    expect(AGENT_TEMPLATES.wholesale_sales.instructions.toLowerCase()).toContain("wholesale");
  });

  it("keeps customer_support to the listed tools only", () => {
    const tools = AGENT_TEMPLATES.customer_support.tools;
    expect(tools).toEqual(
      expect.arrayContaining(["get_product_details", "lookup_customer", "escalate_to_human"]),
    );
    for (const tool of tools) expect(KNOWN_TOOLS.has(tool)).toBe(true);
    // The only write-capable tool support gets is the handover; it cannot create or change customers.
    expect(tools.filter((t) => WRITE_TOOLS.has(t))).toEqual(["escalate_to_human"]);
    // No catalog tool exists beyond the listed ones, and the text must say support cannot change data.
    expect(AGENT_TEMPLATES.customer_support.instructions.toLowerCase()).toContain("cannot change");
  });

  it("stays within the schema bounds for long text", () => {
    for (const role of AGENT_ROLES) {
      const t = AGENT_TEMPLATES[role];
      expect(t.instructions.length).toBeLessThanOrEqual(8000);
      expect(t.personality.length).toBeLessThanOrEqual(1000);
      expect(t.description.length).toBeLessThanOrEqual(500);
    }
  });
});
