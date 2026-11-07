import { describe, expect, it } from "vitest";

import { CUSTOMER_SEGMENTS } from "@/schemas/customer";

import { LEAD_SEGMENTS } from "./lead-segments";

describe("LEAD_SEGMENTS", () => {
  it("is exactly the four open-pipeline segments", () => {
    expect([...LEAD_SEGMENTS].sort()).toEqual(
      ["interested", "new_lead", "potential_buyer", "qualified_lead"].sort(),
    );
  });

  it("is a subset of CUSTOMER_SEGMENTS", () => {
    for (const s of LEAD_SEGMENTS) expect(CUSTOMER_SEGMENTS).toContain(s);
  });

  it("excludes converted, repeat, wholesale and inactive customers", () => {
    for (const s of ["converted", "repeat_customer", "wholesale_customer", "inactive"] as const) {
      expect(LEAD_SEGMENTS).not.toContain(s);
    }
  });

  it("fits a Firestore 'in' clause (30 values at most)", () => {
    expect(LEAD_SEGMENTS.length).toBeGreaterThan(0);
    expect(LEAD_SEGMENTS.length).toBeLessThanOrEqual(30);
  });
});
