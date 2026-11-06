import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  VARIANT_ID_PATTERN,
  categoryInputSchema,
  imageCloudName,
  productInputSchema,
  productPatchSchema,
} from "./product";

// Non-ASCII text is built from code points so this file stays ASCII.
const cp = (...codes: number[]) => String.fromCodePoint(...codes);
const BN_NAME = cp(0x09b6, 0x09be, 0x09a1, 0x09bc, 0x09bf);
const E_ACUTE = cp(0x00e9);
const DOTLESS_I = cp(0x0131); // upper-cases to ASCII "I": must still be rejected in a SKU
const ZWSP = cp(0x200b);

const ORG = "org1";
const img = (over: Record<string, unknown> = {}) => ({
  url: `https://res.cloudinary.com/demo/image/upload/v1700000000/organizations/${ORG}/products/a1.jpg`,
  publicId: `organizations/${ORG}/products/a1`,
  width: 800,
  height: 600,
  ...over,
});
const base = (over: Record<string, unknown> = {}) => ({
  name: "Cotton Shirt",
  sku: "shirt-001",
  regularPriceMinor: 120000,
  ...over,
});
const ok = (over?: Record<string, unknown>) => productInputSchema.parse(base(over));
const bad = (over: Record<string, unknown>) => productInputSchema.safeParse(base(over));
const patch = (p: Record<string, unknown>) => productPatchSchema.safeParse(p);

describe("source hygiene", () => {
  it.each([
    "src/schemas/product.ts",
    "src/schemas/helpers.ts",
    "src/lib/slug.ts",
    "src/lib/text.ts",
    "src/schemas/product.test.ts",
  ])("%s contains only ASCII", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    expect(/[^\x00-\x7F]/u.test(source)).toBe(false);
  });
});

describe("productInputSchema: defaults and normalisation", () => {
  it("applies defaults for the optional collections", () => {
    expect(ok()).toEqual({
      name: "Cotton Shirt",
      sku: "SHIRT-001",
      regularPriceMinor: 120000,
      images: [],
      variants: [],
      availability: "draft",
      specifications: {},
      faqs: [],
    });
  });

  it("trims and upper-cases the SKU", () => {
    expect(ok({ sku: "  ab-12.x_9  " }).sku).toBe("AB-12.X_9");
  });

  it.each([
    "has space",
    "a/b",
    "a\\b",
    "",
    "   ",
    `caf${E_ACUTE}`,
    `${DOTLESS_I}stanbul`,
    "x".repeat(65),
    "a#b",
  ])("rejects SKU %j", (sku) => {
    expect(bad({ sku }).success).toBe(false);
  });
  it("accepts a 64 character SKU", () => {
    expect(bad({ sku: "A".repeat(64) }).success).toBe(true);
  });

  it("accepts Bangla names, NFC-normalises and trims", () => {
    expect(ok({ name: `  ${BN_NAME}  ` }).name).toBe(BN_NAME);
    expect(ok({ name: `e${cp(0x0301)}` }).name).toBe(E_ACUTE);
  });
  it("rejects blank, over-long and invisible-only names", () => {
    expect(bad({ name: "   " }).success).toBe(false);
    expect(bad({ name: `${ZWSP}${ZWSP}` }).success).toBe(false);
    expect(bad({ name: "a".repeat(201) }).success).toBe(false);
    expect(bad({ name: "a".repeat(200) }).success).toBe(true);
  });

  it("strips unknown and managed keys", () => {
    const out = ok({
      slug: "evil",
      archived: true,
      organizationId: "other",
      id: "x",
      createdAt: "2020-01-01",
      nameLower: "x",
      skuLower: "y",
      isAdmin: true,
    });
    for (const key of [
      "slug",
      "archived",
      "organizationId",
      "id",
      "createdAt",
      "nameLower",
      "skuLower",
      "isAdmin",
    ]) {
      expect(out).not.toHaveProperty(key);
    }
  });

  it("omits blank description, rejects null and over-long description", () => {
    expect(ok({ description: "   " })).not.toHaveProperty("description");
    expect(bad({ description: null }).success).toBe(false);
    expect(bad({ description: "d".repeat(5001) }).success).toBe(false);
    expect(bad({ description: "d".repeat(5000) }).success).toBe(true);
  });
});

describe("productInputSchema: money", () => {
  it.each([12.5, -1, Number.NaN, Number.POSITIVE_INFINITY, "100", null, 1_000_000_001])(
    "rejects regularPriceMinor %j",
    (v) => {
      expect(bad({ regularPriceMinor: v }).success).toBe(false);
    },
  );
  it("accepts 0 and the cap", () => {
    expect(bad({ regularPriceMinor: 0 }).success).toBe(true);
    expect(bad({ regularPriceMinor: 1_000_000_000 }).success).toBe(true);
  });
  it("rejects float or negative sale and wholesale prices", () => {
    expect(bad({ salePriceMinor: 1.5 }).success).toBe(false);
    expect(bad({ salePriceMinor: -1 }).success).toBe(false);
    expect(bad({ wholesalePriceMinor: 0.1 }).success).toBe(false);
    expect(bad({ wholesalePriceMinor: -5 }).success).toBe(false);
  });
  it("rejects sale > regular but allows sale == regular", () => {
    const r = bad({ salePriceMinor: 120001 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.path).toEqual(["salePriceMinor"]);
    expect(bad({ salePriceMinor: 120000 }).success).toBe(true);
  });
  it("wholesale is independent of regular", () => {
    expect(ok({ wholesalePriceMinor: 999999 }).wholesalePriceMinor).toBe(999999);
  });
});

describe("productInputSchema: images", () => {
  it("accepts up to 10 images, rejects 11", () => {
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        img({
          url: `https://res.cloudinary.com/demo/image/upload/v1/organizations/${ORG}/products/p${i}.png`,
          publicId: `organizations/${ORG}/products/p${i}`,
        }),
      );
    expect(bad({ images: mk(10) }).success).toBe(true);
    expect(bad({ images: mk(11) }).success).toBe(false);
  });

  it.each([
    "https://example.com/organizations/org1/products/a1.jpg",
    "https://res.cloudinary.com.evil.com/demo/image/upload/organizations/org1/products/a1.jpg",
    "https://evil.com/res.cloudinary.com/demo/image/upload/organizations/org1/products/a1.jpg",
    "http://res.cloudinary.com/demo/image/upload/organizations/org1/products/a1.jpg",
    "https://user:pw@res.cloudinary.com/demo/image/upload/organizations/org1/products/a1.jpg",
    "https://res.cloudinary.com:8443/demo/image/upload/organizations/org1/products/a1.jpg",
    "https://res.cloudinary.com/demo/image/upload/organizations/org1/products/a1.jpg?x=1",
    "https://res.cloudinary.com/demo/image/upload/organizations/org1/products/a1.jpg#f",
    "javascript:alert(1)",
    "//res.cloudinary.com/demo/image/upload/organizations/org1/products/a1.jpg",
    "not a url",
  ])("rejects image url %s", (url) => {
    expect(bad({ images: [img({ url })] }).success).toBe(false);
  });

  it("rejects a url whose asset path is not the publicId (cross-asset attach)", () => {
    const url =
      "https://res.cloudinary.com/demo/image/upload/v1/organizations/org2/products/stolen.jpg";
    expect(bad({ images: [img({ url })] }).success).toBe(false);
  });
  it("rejects transformation segments and traversal in the publicId", () => {
    const transformed =
      "https://res.cloudinary.com/demo/image/upload/c_fill,w_9/organizations/org1/products/a1.jpg";
    expect(bad({ images: [img({ url: transformed })] }).success).toBe(false);
    const publicId = "organizations/org1/products/../../org2/products/x";
    const url = `https://res.cloudinary.com/demo/image/upload/${publicId}.jpg`;
    expect(bad({ images: [img({ publicId, url })] }).success).toBe(false);
  });
  it("rejects the same publicId twice in one product", () => {
    expect(bad({ images: [img(), img()] }).success).toBe(false);
  });
  it("extracts the cloud name of a delivery URL", () => {
    expect(imageCloudName(img().url)).toBe("demo");
    expect(imageCloudName("https://example.com/demo/image/upload/a")).toBeNull();
    expect(imageCloudName("http://res.cloudinary.com/demo/image/upload/a")).toBeNull();
    expect(imageCloudName("nope")).toBeNull();
  });
  it("accepts a url without a version or extension", () => {
    const url = "https://res.cloudinary.com/demo/image/upload/organizations/org1/products/a1";
    expect(bad({ images: [img({ url })] }).success).toBe(true);
  });
  it("requires positive integer dimensions", () => {
    for (const bd of [{ width: 0 }, { height: -1 }, { width: 1.5 }, { width: "8" }]) {
      expect(bad({ images: [img(bd)] }).success).toBe(false);
    }
  });
});

describe("VARIANT_ID_PATTERN", () => {
  it("is the single source for variant id syntax", () => {
    expect(VARIANT_ID_PATTERN.test("v-abc123")).toBe(true);
    expect(VARIANT_ID_PATTERN.test("V-1")).toBe(false);
    expect(VARIANT_ID_PATTERN.test("a".repeat(41))).toBe(false);
  });
});

describe("productInputSchema: variants", () => {
  it("accepts variants without ids (assigned by the service)", () => {
    const out = ok({ variants: [{ size: "M" }, { color: "Red", sku: " v-1 " }] });
    expect(out.variants[0]).toEqual({ size: "M" });
    expect(out.variants[1]).toEqual({ color: "Red", sku: "V-1" });
  });
  it("keeps a valid id", () => {
    expect(ok({ variants: [{ id: "v-abc123", size: "M" }] }).variants[0]!.id).toBe("v-abc123");
  });
  it.each(["V-1", "a b", "a_b", "a/b", "", "x".repeat(41), "default", `caf${E_ACUTE}`])(
    "rejects variant id %j",
    (id) => {
      expect(bad({ variants: [{ id, size: "M" }] }).success).toBe(false);
    },
  );
  it("accepts a 40 character id", () => {
    expect(bad({ variants: [{ id: "a".repeat(40), size: "M" }] }).success).toBe(true);
  });
  it("rejects duplicate variant ids", () => {
    expect(
      bad({
        variants: [
          { id: "a", size: "M" },
          { id: "a", size: "L" },
        ],
      }).success,
    ).toBe(false);
  });
  it("requires size or color, limits their length and the count", () => {
    expect(bad({ variants: [{}] }).success).toBe(false);
    expect(bad({ variants: [{ id: "a" }] }).success).toBe(false);
    expect(bad({ variants: [{ size: "  " }] }).success).toBe(false);
    expect(bad({ variants: [{ size: "x".repeat(41) }] }).success).toBe(false);
    expect(bad({ variants: [{ color: "x".repeat(40) }] }).success).toBe(true);
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ size: `S${i}` }));
    expect(bad({ variants: many(50) }).success).toBe(true);
    expect(bad({ variants: many(51) }).success).toBe(false);
  });
});

describe("productInputSchema: specifications, faqs, enums", () => {
  it("accepts a normal record", () => {
    expect(ok({ specifications: { Material: "Cotton", Fit: " Slim " } }).specifications).toEqual({
      Material: "Cotton",
      Fit: "Slim",
    });
  });
  it("rejects prototype-polluting keys (including a parsed JSON __proto__)", () => {
    for (const key of ["__proto__", "constructor", "prototype"]) {
      expect(bad({ specifications: { [key]: "x" } }).success, key).toBe(false);
    }
    const parsed = JSON.parse('{"__proto__": "x"}') as Record<string, string>;
    expect(bad({ specifications: parsed }).success).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("rejects dotted, slashed, reserved-pattern, empty and over-long keys; bad values", () => {
    for (const key of ["a.b", "a/b", "__x__", "", "k".repeat(61)]) {
      expect(bad({ specifications: { [key]: "v" } }).success, key).toBe(false);
    }
    expect(bad({ specifications: { k: "v".repeat(301) } }).success).toBe(false);
    expect(bad({ specifications: { k: "v".repeat(300) } }).success).toBe(true);
    expect(bad({ specifications: { k: 5 } }).success).toBe(false);
  });
  it("limits to 30 entries and requires an object", () => {
    const rec = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, "v"]));
    expect(bad({ specifications: rec(30) }).success).toBe(true);
    expect(bad({ specifications: rec(31) }).success).toBe(false);
    expect(bad({ specifications: [] }).success).toBe(false);
    expect(bad({ specifications: null }).success).toBe(false);
  });
  it("validates faqs", () => {
    expect(ok({ faqs: [{ q: " Q? ", a: "A" }] }).faqs).toEqual([{ q: "Q?", a: "A" }]);
    expect(bad({ faqs: [{ q: "", a: "A" }] }).success).toBe(false);
    expect(bad({ faqs: [{ q: "q".repeat(201), a: "A" }] }).success).toBe(false);
    expect(bad({ faqs: [{ q: "q", a: "a".repeat(1001) }] }).success).toBe(false);
    const many = (n: number) => Array.from({ length: n }, () => ({ q: "q", a: "a" }));
    expect(bad({ faqs: many(20) }).success).toBe(true);
    expect(bad({ faqs: many(21) }).success).toBe(false);
  });
  it("validates availability and categoryId", () => {
    expect(bad({ availability: "sold" }).success).toBe(false);
    expect(ok({ availability: "active" }).availability).toBe("active");
    expect(bad({ categoryId: "a/b" }).success).toBe(false);
    expect(ok({ categoryId: "cat1" }).categoryId).toBe("cat1");
  });
});

describe("productPatchSchema", () => {
  it("applies no defaults", () => {
    const r = productPatchSchema.parse({ name: " New " });
    expect(r).toEqual({ name: "New" });
  });
  it("rejects an empty patch, also after stripping unknown/managed keys", () => {
    expect(patch({}).success).toBe(false);
    expect(
      patch({ slug: "x", archived: true, organizationId: "o", id: "i", createdAt: "x" }).success,
    ).toBe(false);
  });
  it("strips managed keys next to valid ones", () => {
    const r = productPatchSchema.parse({
      name: "A",
      slug: "x",
      archived: true,
      nameLower: "q",
      skuLower: "q",
    });
    expect(r).toEqual({ name: "A" });
  });
  it("null (or a blank string for description) clears the optional fields", () => {
    const r = productPatchSchema.parse({
      salePriceMinor: null,
      wholesalePriceMinor: null,
      categoryId: null,
      description: null,
    });
    expect(r).toEqual({
      salePriceMinor: null,
      wholesalePriceMinor: null,
      categoryId: null,
      description: null,
    });
    expect(productPatchSchema.parse({ description: "   " }).description).toBeNull();
  });
  it("rejects null on required fields", () => {
    for (const key of [
      "name",
      "sku",
      "regularPriceMinor",
      "availability",
      "images",
      "variants",
      "specifications",
      "faqs",
    ]) {
      expect(patch({ [key]: null }).success, key).toBe(false);
    }
  });
  it("validates the same rules as create", () => {
    expect(patch({ regularPriceMinor: 1.5 }).success).toBe(false);
    expect(patch({ sku: "bad sku" }).success).toBe(false);
    expect(productPatchSchema.parse({ sku: " ok-1 " })).toEqual({ sku: "OK-1" });
    expect(patch({ images: [img({ url: "http://res.cloudinary.com/x" })] }).success).toBe(false);
    expect(patch({ specifications: JSON.parse('{"__proto__": "x"}') }).success).toBe(false);
  });
  it("checks sale <= regular only when both are in the patch (the service checks the merge)", () => {
    expect(patch({ regularPriceMinor: 100, salePriceMinor: 101 }).success).toBe(false);
    expect(patch({ regularPriceMinor: 100, salePriceMinor: 100 }).success).toBe(true);
    expect(patch({ salePriceMinor: 10_000_000 }).success).toBe(true);
    expect(patch({ regularPriceMinor: 1, salePriceMinor: null }).success).toBe(true);
  });
});

describe("categoryInputSchema", () => {
  it("normalises the name and omits a blank description", () => {
    expect(categoryInputSchema.parse({ name: ` ${BN_NAME} `, description: " " })).toEqual({
      name: BN_NAME,
    });
  });
  it("validates lengths and strips unknown keys", () => {
    expect(categoryInputSchema.safeParse({ name: "" }).success).toBe(false);
    expect(categoryInputSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
    expect(categoryInputSchema.safeParse({ name: "x".repeat(80) }).success).toBe(true);
    expect(categoryInputSchema.safeParse({ name: "a", description: "d".repeat(501) }).success).toBe(
      false,
    );
    expect(categoryInputSchema.parse({ name: "a", organizationId: "o", slug: "s" })).toEqual({
      name: "a",
    });
  });
});
