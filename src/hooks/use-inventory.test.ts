import { describe, expect, it } from "vitest";

import { buildInventoryQuery, isUnconfirmedError } from "@/hooks/use-inventory";
import { ApiError } from "@/lib/api/client";

const str = (p: Parameters<typeof buildInventoryQuery>[0]) => buildInventoryQuery(p).toString();

describe("buildInventoryQuery", () => {
  it("is empty for no params and for lowStock=false", () => {
    expect(str({})).toBe("");
    expect(str({ lowStock: false })).toBe("");
  });

  it("sends lowStock=true, limit and cursor", () => {
    const q = buildInventoryQuery({ lowStock: true, limit: 25, cursor: "abc" });
    expect(q.get("lowStock")).toBe("true");
    expect(q.get("limit")).toBe("25");
    expect(q.get("cursor")).toBe("abc");
  });

  it("never sends productId together with lowStock (the API answers 400)", () => {
    const q = buildInventoryQuery({ productId: "p1", lowStock: true });
    expect(q.get("productId")).toBe("p1");
    expect(q.has("lowStock")).toBe(false);
  });

  it("trims values and drops blanks and non-positive limits", () => {
    expect(buildInventoryQuery({ productId: " p1 " }).get("productId")).toBe("p1");
    expect(str({ productId: "  ", cursor: "", limit: 0 })).toBe("");
  });
});

describe("isUnconfirmedError", () => {
  const err = (status: number, code: string) => new ApiError({ status, code, message: "m" });

  it("treats network failures, unreadable responses and server errors as unconfirmed", () => {
    expect(isUnconfirmedError(err(0, "NETWORK"))).toBe(true);
    expect(isUnconfirmedError(err(200, "BAD_RESPONSE"))).toBe(true);
    expect(isUnconfirmedError(err(500, "INTERNAL_ERROR"))).toBe(true);
    expect(isUnconfirmedError(new TypeError("boom"))).toBe(true);
  });

  it("treats definite answers as confirmed failures that changed nothing", () => {
    expect(isUnconfirmedError(err(409, "CONFLICT"))).toBe(false);
    expect(isUnconfirmedError(err(400, "VALIDATION_ERROR"))).toBe(false);
    expect(isUnconfirmedError(err(404, "NOT_FOUND"))).toBe(false);
    expect(isUnconfirmedError(err(429, "RATE_LIMITED"))).toBe(false);
  });
});
