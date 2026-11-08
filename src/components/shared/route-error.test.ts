import { describe, expect, it } from "vitest";

import { errorDigest } from "./route-error";

describe("errorDigest", () => {
  it("returns the digest of a server error", () => {
    expect(errorDigest(Object.assign(new Error("x"), { digest: "abc123" }))).toBe("abc123");
  });

  it.each([new Error("x"), "boom", null, undefined, 42, { digest: 5 }, { digest: "" }])(
    "returns undefined when there is no usable digest (%s)",
    (value) => {
      expect(errorDigest(value)).toBeUndefined();
    },
  );
});
