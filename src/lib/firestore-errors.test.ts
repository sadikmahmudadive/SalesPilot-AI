import { describe, expect, it } from "vitest";

import { isAlreadyExists, isContention } from "./firestore-errors";

describe("isContention", () => {
  it("is true only for ABORTED", () => {
    expect(isContention(Object.assign(new Error("x"), { code: 10 }))).toBe(true);
    expect(isContention({ code: "aborted" })).toBe(true);
  });
  it("is false for outages, quota errors, HTTP 409 and anything else", () => {
    for (const code of [14, 8, 4, 13, 6, 409, 0, "unavailable", "ABORTED", undefined, null]) {
      expect(isContention({ code }), String(code)).toBe(false);
    }
    expect(isContention(new Error("Exceeded maximum number of retries allowed."))).toBe(false);
    expect(isContention(null)).toBe(false);
    expect(isContention(undefined)).toBe(false);
    expect(isContention("aborted")).toBe(false);
  });
  it("does not overlap with isAlreadyExists", () => {
    expect(isAlreadyExists({ code: 10 })).toBe(false);
    expect(isContention({ code: 6 })).toBe(false);
  });
});
