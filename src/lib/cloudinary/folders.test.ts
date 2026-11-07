import { describe, expect, it } from "vitest";

import { ForbiddenError, ValidationError } from "@/lib/errors";

import {
  MAX_IMAGE_BYTES,
  UPLOAD_KINDS,
  assertOwnedPublicId,
  kindPermission,
  orgFolder,
  uploadPolicy,
} from "./folders";

describe("orgFolder", () => {
  it("builds organizations/{org}/{kind}", () => {
    expect(orgFolder("org1", "products")).toBe("organizations/org1/products");
    expect(orgFolder("org_1-x", "campaigns")).toBe("organizations/org_1-x/campaigns");
  });

  it.each(["", "a/b", "..", ".", "a b", "a%2e", "a\\b", "__x__", "a\x00b"])("rejects org id %j", (id) => {
    expect(() => orgFolder(id, "products")).toThrow();
  });
});

describe("kindPermission", () => {
  it("maps kinds to permissions", () => {
    expect(kindPermission("products")).toBe("uploads:products");
    expect(kindPermission("customers")).toBe("uploads:customers");
    expect(kindPermission("knowledge")).toBe("uploads:org");
    expect(kindPermission("campaigns")).toBe("uploads:org");
  });
});

describe("uploadPolicy", () => {
  it("allows the four image types up to 5 MB for products, customers and campaigns", () => {
    expect(MAX_IMAGE_BYTES).toBe(5_242_880);
    for (const kind of ["products", "customers", "campaigns"] as const) {
      const p = uploadPolicy(kind);
      expect(p.maxBytes).toBe(5_242_880);
      expect([...p.contentTypes]).toEqual(["image/jpeg", "image/png", "image/webp", "image/avif"]);
      expect([...p.formats]).toEqual(["jpg", "png", "webp", "avif"]);
    }
  });

  it("rejects knowledge with a static validation error", () => {
    expect(() => uploadPolicy("knowledge")).toThrow(ValidationError);
    expect(() => uploadPolicy("knowledge")).toThrow("Knowledge uploads are not available yet");
  });

  it("lists every kind", () => {
    expect([...UPLOAD_KINDS]).toEqual(["products", "customers", "knowledge", "campaigns"]);
  });
});

describe("assertOwnedPublicId", () => {
  it("returns the kind for owned ids", () => {
    expect(assertOwnedPublicId("A", "organizations/A/products/abc123")).toBe("products");
    expect(assertOwnedPublicId("A", "organizations/A/customers/sub/dir/x_y-z.1")).toBe("customers");
    expect(assertOwnedPublicId("A", "organizations/A/knowledge/x")).toBe("knowledge");
    expect(assertOwnedPublicId("A", "organizations/A/campaigns/x")).toBe("campaigns");
  });

  const bad: Array<[string, string]> = [
    ["another org", "organizations/B/products/x"],
    ["prefix confusion (AB vs A)", "organizations/AB/products/x"],
    ["traversal", "organizations/A/products/../../B/x"],
    ["dot segment", "organizations/A/products/./x"],
    ["encoded dots", "organizations/A/products/%2e%2e/x"],
    ["encoded slash", "organizations/A/products/a%2Fb"],
    ["backslash", "organizations/A/products/a\\b"],
    ["empty segment", "organizations/A/products//x"],
    ["trailing slash", "organizations/A/products/x/"],
    ["leading slash", "/organizations/A/products/x"],
    ["no leaf", "organizations/A/products"],
    ["no leaf slash", "organizations/A/products/"],
    ["unknown kind", "organizations/A/secrets/x"],
    ["kind prefix confusion", "organizations/A/productsX/x"],
    ["control char", "organizations/A/products/a\x01b"],
    ["newline", "organizations/A/products/a\nb"],
    ["null byte", "organizations/A/products/a\x00"],
    ["del char", "organizations/A/products/a\x7fb"],
    ["space", "organizations/A/products/a b"],
    ["non-ascii", "organizations/A/products/caf" + String.fromCharCode(0xe9)],
    ["segment starting with dot", "organizations/A/products/.hidden"],
    ["empty", ""],
    ["too long", `organizations/A/products/${"a".repeat(600)}`],
    ["wrong root", "orgs/A/products/x"],
  ];
  it.each(bad)("forbids %s", (_name, id) => {
    expect(() => assertOwnedPublicId("A", id)).toThrow(ForbiddenError);
  });

  it("is exact on the org segment in both directions", () => {
    expect(() => assertOwnedPublicId("AB", "organizations/A/products/x")).toThrow(ForbiddenError);
    expect(() => assertOwnedPublicId("A", "organizations/AB/products/x")).toThrow(ForbiddenError);
  });

  it("accepts a 512-character id and rejects 513", () => {
    const head = "organizations/A/products/";
    expect(assertOwnedPublicId("A", head + "a".repeat(512 - head.length))).toBe("products");
    expect(() => assertOwnedPublicId("A", head + "a".repeat(513 - head.length))).toThrow(ForbiddenError);
  });

  it("rejects non-strings", () => {
    expect(() => assertOwnedPublicId("A", undefined as unknown as string)).toThrow(ForbiddenError);
    expect(() => assertOwnedPublicId("A", 5 as unknown as string)).toThrow(ForbiddenError);
  });

  it("never echoes the id", () => {
    let message = "";
    try {
      assertOwnedPublicId("A", "organizations/B/products/SECRET-ID");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("SECRET-ID");
    expect(message).not.toContain("organizations/B");
  });
});
