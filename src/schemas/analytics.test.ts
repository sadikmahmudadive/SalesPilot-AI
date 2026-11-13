import { describe, expect, it } from "vitest";

import { ANALYTICS_RANGES, analyticsQuerySchema } from "./analytics";

describe("analyticsQuerySchema", () => {
  it("defaults range to 30d when omitted", () => {
    expect(analyticsQuerySchema.parse({})).toEqual({ range: "30d" });
  });

  it("accepts all supported ranges", () => {
    for (const range of ANALYTICS_RANGES) {
      expect(analyticsQuerySchema.parse({ range })).toEqual({ range });
    }
  });

  it("rejects unknown ranges", () => {
    expect(analyticsQuerySchema.safeParse({ range: "365d" }).success).toBe(false);
    expect(analyticsQuerySchema.safeParse({ range: "bad" }).success).toBe(false);
  });
});
