import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";

import { resolveListLimit } from "./list-params";

const opts = { defaultLimit: 25, maxLimit: 50 };

describe("resolveListLimit", () => {
  it("uses the default when the limit is undefined", () => {
    expect(resolveListLimit(undefined, opts)).toBe(25);
  });

  it("accepts the boundaries and values in between", () => {
    expect(resolveListLimit(1, opts)).toBe(1);
    expect(resolveListLimit(30, opts)).toBe(30);
    expect(resolveListLimit(50, opts)).toBe(50);
  });

  it.each([0, 51, 1.5, Number.NaN, -1, Number.POSITIVE_INFINITY])("rejects %s", (bad) => {
    expect(() => resolveListLimit(bad, opts)).toThrow(ValidationError);
  });

  it("uses a static message that names the maximum and never echoes the value", () => {
    try {
      resolveListLimit(999, { defaultLimit: 10, maxLimit: 20 });
      expect.unreachable();
    } catch (e) {
      const err = e as ValidationError;
      expect(err.details).toEqual([
        { path: "limit", message: "Limit must be an integer between 1 and 20" },
      ]);
      expect(err.message).not.toContain("999");
    }
  });
});
