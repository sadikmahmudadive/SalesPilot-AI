import { describe, expect, it } from "vitest";
import { z } from "zod";

import { NotFoundError, ValidationError } from "@/lib/errors";

import { cursorParam, limitParam, optionalParam, parseQueryParams } from "./list-params";
import { assertEntityId, assertOrgCtx } from "./org-context";
import { stableJson } from "./stable-json";

describe("stableJson", () => {
  it("sorts keys deeply, drops undefined and keeps array order", () => {
    expect(stableJson({ b: 1, a: { d: [2, 1], c: undefined } })).toBe('{"a":{"d":[2,1]},"b":1}');
    expect(stableJson(undefined)).toBe("null");
    expect(stableJson(null)).toBe("null");
  });
  it("is equal for equal values regardless of key order", () => {
    expect(stableJson({ x: 1, y: [1, { q: 1, p: 2 }] })).toBe(
      stableJson({ y: [1, { p: 2, q: 1 }], x: 1 }),
    );
  });
});

describe("assertOrgCtx / assertEntityId", () => {
  it("accepts a valid context and names the service in the failure", () => {
    expect(() => assertOrgCtx({ organizationId: "org1", uid: "u1" }, "Thing")).not.toThrow();
    for (const bad of [
      null,
      undefined,
      { organizationId: "", uid: "u" },
      { organizationId: "o/1", uid: "u" },
      { organizationId: "o", uid: " " },
    ]) {
      expect(() => assertOrgCtx(bad as never, "Thing")).toThrow(
        "Thing service requires an organization and user context",
      );
    }
  });
  it("turns invalid ids into NotFound", () => {
    expect(() => assertEntityId("abc")).not.toThrow();
    for (const bad of ["", "a/b", "..", 5, null])
      expect(() => assertEntityId(bad)).toThrow(NotFoundError);
  });
});

describe("parseQueryParams", () => {
  const schema = z.object({
    q: optionalParam(z.string().max(5)),
    limit: limitParam(50),
    cursor: cursorParam(),
  });
  const parse = (s: string) => parseQueryParams(new URLSearchParams(s), schema);

  it("parses known keys, ignores unknown and treats empty as absent", () => {
    expect(parse("q=ab&limit=10&zzz=1")).toEqual({ q: "ab", limit: 10 });
    expect(parse("q=&limit=")).toEqual({});
  });
  it("rejects repeated keys and invalid values with static messages", () => {
    expect(() => parse("q=a&q=b")).toThrow(ValidationError);
    for (const s of ["limit=0", "limit=51", "limit=x", "q=toolong"])
      expect(() => parse(s), s).toThrow(ValidationError);
    try {
      parse("q=toolong-secret");
    } catch (err) {
      expect(JSON.stringify((err as ValidationError).details)).not.toContain("secret");
    }
  });
});
