import { describe, expect, it } from "vitest";

import { ValidationError } from "./errors";
import { decodeCursor, encodeCursor, type Cursor } from "./pagination";
import { isValidIdSegment } from "./ids";

const b64 = (value: unknown) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

function expectInvalid(token: unknown) {
  try {
    decodeCursor(token);
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return;
  }
  throw new Error("expected decodeCursor to throw ValidationError");
}

describe("cursor round trip", () => {
  const cases: Cursor[] = [
    { t: "ts", v: "2026-11-06T10:20:30.123456789Z", id: "doc-1" },
    { t: "s", v: "héllo wörld ✓", id: "doc-2" },
    { t: "s", v: "", id: "doc-3" },
    { t: "n", v: -12.5, id: "doc-4" },
    { t: "n", v: 0, id: "doc-5" },
    { t: "b", v: true, id: "doc-6" },
    { t: "b", v: false, id: "doc-7" },
    { t: "null", v: null, id: "doc-8" },
  ];
  it.each(cases)("round-trips $t", (cursor) => {
    const token = encodeCursor(cursor);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(token)).toEqual(cursor);
  });
});

describe("encodeCursor", () => {
  it("throws a plain Error (not a ValidationError) when the token would exceed the size cap", () => {
    try {
      encodeCursor({ t: "s", v: "x".repeat(2000), id: "d" });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(ValidationError);
      return;
    }
    throw new Error("expected encodeCursor to throw");
  });
});

describe("decodeCursor rejects bad input", () => {
  it("non-string input", () => {
    for (const bad of [undefined, null, 5, {}, [], true]) expectInvalid(bad);
  });
  it("empty and garbage strings", () => {
    expectInvalid("");
    expectInvalid("!!!not base64!!!");
    expectInvalid("abc def");
    expectInvalid("a/b+c=");
  });
  it("valid base64url that is not JSON", () => {
    expectInvalid(b64("not json"));
  });
  it("oversized tokens", () => {
    expectInvalid("A".repeat(1025));
    expectInvalid(b64({ t: "s", v: "x".repeat(2000), id: "d" }));
  });
  it("wrong shapes", () => {
    expectInvalid(b64(null));
    expectInvalid(b64([]));
    expectInvalid(b64("str"));
    expectInvalid(b64({ t: "s", v: "x" }));
    expectInvalid(b64({ t: "s", id: "d" }));
    expectInvalid(b64({ v: "x", id: "d" }));
    expectInvalid(b64({ t: "s", v: "x", id: "d", extra: 1 }));
    expectInvalid(b64({ t: "s", v: "x", id: 5 }));
  });
  it("unknown type tag", () => {
    expectInvalid(b64({ t: "obj", v: "x", id: "d" }));
    expectInvalid(b64({ t: "ref", v: "users/1", id: "d" }));
  });
  it("value type mismatching its tag", () => {
    expectInvalid(b64({ t: "ts", v: 5, id: "d" }));
    expectInvalid(b64({ t: "s", v: 5, id: "d" }));
    expectInvalid(b64({ t: "n", v: "5", id: "d" }));
    expectInvalid(b64({ t: "n", v: null, id: "d" }));
    expectInvalid(b64({ t: "b", v: "true", id: "d" }));
    expectInvalid(b64({ t: "null", v: 0, id: "d" }));
    expectInvalid(b64({ t: "s", v: { $gt: "" }, id: "d" }));
  });
  it("tampered JSON (flipped bytes)", () => {
    const token = encodeCursor({ t: "s", v: "abc", id: "doc" });
    expectInvalid(token.slice(0, -3) + "!!!");
    expectInvalid(token.slice(0, 5));
  });
  it("ids that are not a valid id segment", () => {
    expectInvalid(b64({ t: "s", v: "x", id: "a/b" }));
    expectInvalid(b64({ t: "s", v: "x", id: "organizations/other" }));
    expectInvalid(b64({ t: "s", v: "x", id: "" }));
    expectInvalid(b64({ t: "s", v: "x", id: ".." }));
    expectInvalid(b64({ t: "s", v: "x", id: "." }));
  });
  it("never carries the offending input in details", () => {
    try {
      decodeCursor(b64({ t: "s", v: "secret-value", id: "a/b" }));
    } catch (error) {
      expect(JSON.stringify((error as ValidationError).details)).not.toContain("secret-value");
    }
  });
});

describe("isValidIdSegment", () => {
  it("accepts ordinary ids", () => {
    for (const id of ["abc", "org-123", "a_b.c", "x".repeat(1500)]) expect(isValidIdSegment(id)).toBe(true);
  });
  it("rejects bad ids", () => {
    for (const id of ["", "a/b", "/", ".", "..", "__x__", "x".repeat(1501), "é".repeat(751), 5, null, undefined, {}]) {
      expect(isValidIdSegment(id)).toBe(false);
    }
  });
});
