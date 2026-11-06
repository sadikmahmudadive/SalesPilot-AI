import { describe, expect, it } from "vitest";

import { adjustInputSchema } from "./inventory";

const ok = { productId: "p1", variantId: "default", delta: 5, reason: "Stock count" };
const parse = (over: Record<string, unknown>) => adjustInputSchema.safeParse({ ...ok, ...over });

describe("adjustInputSchema", () => {
  it("accepts a valid adjustment and trims the reason", () => {
    const r = parse({ reason: "  Damaged goods  ", delta: -3 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ reason: "Damaged goods", delta: -3 });
  });
  it("accepts the delta bounds", () => {
    expect(parse({ delta: 1_000_000 }).success).toBe(true);
    expect(parse({ delta: -1_000_000 }).success).toBe(true);
  });
  it.each([0, 1.5, -0.5, 1_000_001, -1_000_001, Number.NaN, Number.POSITIVE_INFINITY, "5", null])(
    "rejects delta %s",
    (delta) => {
      expect(parse({ delta }).success).toBe(false);
    },
  );
  it("requires a reason of 3 to 200 trimmed characters", () => {
    expect(parse({ reason: "ab" }).success).toBe(false);
    expect(parse({ reason: "   a  " }).success).toBe(false);
    expect(parse({ reason: "abc" }).success).toBe(true);
    expect(parse({ reason: "x".repeat(200) }).success).toBe(true);
    expect(parse({ reason: "x".repeat(201) }).success).toBe(false);
    expect(parse({ reason: undefined }).success).toBe(false);
    expect(parse({ reason: 123 }).success).toBe(false);
  });
  it("requires product and variant ids and strips unknown keys", () => {
    expect(parse({ productId: "" }).success).toBe(false);
    expect(parse({ variantId: undefined }).success).toBe(false);
    const r = parse({ organizationId: "evil", onHand: 99 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).not.toHaveProperty("organizationId");
  });
});
