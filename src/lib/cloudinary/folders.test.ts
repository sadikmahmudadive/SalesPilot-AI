import { describe, expect, it } from "vitest";

import { ForbiddenError, ValidationError } from "@/lib/errors";
import { productInputSchema } from "@/schemas/product";

import {
  MAX_IMAGE_BYTES,
  UPLOAD_KINDS,
  assertOwnedPublicId,
  assertOwnedPublicIdOfKind,
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

const HEX = "0123456789abcdef01234567"; // 24 lowercase hex characters
const ok = (org: string, kind: string, leaf = HEX) => `organizations/${org}/${kind}/${leaf}`;

describe("assertOwnedPublicId", () => {
  it("accepts exactly the generated form and returns the kind", () => {
    expect(assertOwnedPublicId("A", ok("A", "products"))).toBe("products");
    expect(assertOwnedPublicId("A", ok("A", "customers"))).toBe("customers");
    expect(assertOwnedPublicId("A", ok("A", "knowledge"))).toBe("knowledge");
    expect(assertOwnedPublicId("org_1-x", ok("org_1-x", "campaigns"))).toBe("campaigns");
  });

  const bad: Array<[string, string, string?]> = [
    ["another org", ok("B", "products")],
    ["prefix confusion (AB vs A)", ok("AB", "products")],
    ["traversal", `organizations/A/products/../../B/${HEX}`],
    ["dot segment", `organizations/A/products/./${HEX}`],
    ["encoded dots", `organizations/A/products/%2e%2e/${HEX}`],
    ["encoded slash", `organizations/A/products/a%2Fb`],
    ["backslash", `organizations/A/products/${HEX}${String.fromCharCode(92)}x`],
    ["empty segment", `organizations/A/products//${HEX}`],
    ["trailing slash", `${ok("A", "products")}/`],
    ["leading slash", `/${ok("A", "products")}`],
    ["nested path", `organizations/A/products/sub/${HEX}`],
    ["no leaf", "organizations/A/products"],
    ["no leaf slash", "organizations/A/products/"],
    ["unknown kind", ok("A", "secrets")],
    ["kind prefix confusion", ok("A", "productsX")],
    ["dotted leaf", ok("A", "products", `${HEX}.jpg`)],
    ["dotted leaf of generated length", ok("A", "products", "0123456789abcdef0123.567")],
    ["uppercase leaf", ok("A", "products", HEX.toUpperCase())],
    ["short leaf", ok("A", "products", "abc123")],
    ["long leaf", ok("A", "products", `${HEX}0`)],
    ["non-hex leaf", ok("A", "products", "zzzzzzzzzzzzzzzzzzzzzzzz")],
    ["control char", ok("A", "products", `${HEX}${String.fromCharCode(1)}`)],
    ["newline", ok("A", "products", `${HEX}${String.fromCharCode(10)}`)],
    ["null byte", ok("A", "products", `${HEX}${String.fromCharCode(0)}`)],
    ["del char", ok("A", "products", `${String.fromCharCode(0x7f)}${HEX.slice(1)}`)],
    ["space", ok("A", "products", `${HEX.slice(1)} `)],
    ["non-ascii", ok("A", "products", HEX.slice(2) + String.fromCharCode(0xe9) + "a")],
    ["dotted org", ok("A.b", "products"), "A.b"],
    ["empty", ""],
    ["too long (org id pushes it over 255)", ok("a".repeat(230), "products"), "a".repeat(230)],
    ["wrong root", `orgs/A/products/${HEX}`],
  ];
  it.each(bad)("forbids %s", (_name, id, org = "A") => {
    expect(() => assertOwnedPublicId(org, id)).toThrow(ForbiddenError);
  });

  it("is exact on the org segment in both directions", () => {
    expect(() => assertOwnedPublicId("AB", ok("A", "products"))).toThrow(ForbiddenError);
    expect(() => assertOwnedPublicId("A", ok("AB", "products"))).toThrow(ForbiddenError);
  });

  it("refuses a 255+ character id even when every segment is valid", () => {
    const org = "a".repeat(220);
    const id = ok(org, "products");
    expect(id.length).toBeGreaterThan(255);
    expect(() => assertOwnedPublicId(org, id)).toThrow(ForbiddenError);
  });

  it("rejects non-strings", () => {
    expect(() => assertOwnedPublicId("A", undefined as unknown as string)).toThrow(ForbiddenError);
    expect(() => assertOwnedPublicId("A", 5 as unknown as string)).toThrow(ForbiddenError);
  });

  it("never echoes the id", () => {
    let message = "";
    try {
      assertOwnedPublicId("A", ok("B", "products", "SECRET-ID"));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("SECRET-ID");
    expect(message).not.toContain("organizations/B");
  });

  it("every accepted id satisfies the product image schema", () => {
    const id = ok("org-A", "products");
    const image = {
      url: `https://res.cloudinary.com/demo/image/upload/v1/${id}.jpg`,
      publicId: id,
      width: 10,
      height: 10,
    };
    expect(
      productInputSchema.safeParse({ name: "P", sku: "P1", regularPriceMinor: 1, images: [image] }).success,
    ).toBe(true);
    assertOwnedPublicId("org-A", id);
  });
});

describe("assertOwnedPublicIdOfKind", () => {
  it("passes for the matching kind and forbids a mismatch", () => {
    expect(() => assertOwnedPublicIdOfKind("A", "products", ok("A", "products"))).not.toThrow();
    expect(() => assertOwnedPublicIdOfKind("A", "products", ok("A", "customers"))).toThrow(ForbiddenError);
    expect(() => assertOwnedPublicIdOfKind("A", "products", ok("B", "products"))).toThrow(ForbiddenError);
  });
});
