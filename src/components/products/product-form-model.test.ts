import { describe, expect, it } from "vitest";

import {
  buildProductPatch,
  EMPTY_PRODUCT_VALUES,
  prepareProductBody,
  productToFormValues,
  type ProductFormValues,
} from "@/components/products/product-form-model";
import { productInputSchema, productPatchSchema, type Product } from "@/schemas/product";

const IMAGE = {
  url: "https://res.cloudinary.com/demo/image/upload/v1/organizations/o1/products/shirt.jpg",
  publicId: "organizations/o1/products/shirt",
  width: 800,
  height: 600,
};

const product: Product = {
  id: "p1",
  organizationId: "o1",
  slug: "cotton-shirt",
  archived: false,
  name: "Cotton Shirt",
  sku: "SHIRT-1",
  description: "A soft shirt",
  categoryId: "cat1",
  images: [IMAGE],
  variants: [
    { id: "v-aaaa", size: "M", color: "Blue", sku: "SHIRT-1-M" },
    { id: "v-bbbb", size: "L" },
  ],
  regularPriceMinor: 129900,
  salePriceMinor: 99950,
  wholesalePriceMinor: 80000,
  availability: "active",
  specifications: { Material: "Cotton", Weight: "200g" },
  faqs: [{ q: "Washable?", a: "Yes" }],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const values = (patch: Partial<ProductFormValues> = {}): ProductFormValues => ({
  ...productToFormValues(product),
  ...patch,
});

describe("productToFormValues", () => {
  it("formats prices as taka text and keeps variant ids", () => {
    const v = productToFormValues(product);
    expect(v.regularPrice).toBe("1299.00");
    expect(v.salePrice).toBe("999.50");
    expect(v.wholesalePrice).toBe("800.00");
    expect(v.variants.map((r) => r.id)).toEqual(["v-aaaa", "v-bbbb"]);
    expect(v.variants[1]).toMatchObject({ size: "L", color: "", sku: "" });
    expect(v.specs).toEqual([
      { key: "Material", value: "Cotton" },
      { key: "Weight", value: "200g" },
    ]);
    expect(v.categoryId).toBe("cat1");
    expect(v.images).toEqual([IMAGE]);
  });

  it("uses empty text for absent optional fields", () => {
    const v = productToFormValues({
      ...product,
      description: undefined,
      categoryId: undefined,
      salePriceMinor: undefined,
      wholesalePriceMinor: undefined,
    });
    expect(v).toMatchObject({ description: "", categoryId: "", salePrice: "", wholesalePrice: "" });
  });

  it("starts a new product as a draft with nothing filled in", () => {
    expect(EMPTY_PRODUCT_VALUES).toMatchObject({ name: "", sku: "", availability: "draft", variants: [], specs: [], faqs: [] });
  });
});

describe("prepareProductBody", () => {
  it("round trips an existing product to the stored shape", () => {
    const { body, issues } = prepareProductBody(productToFormValues(product));
    expect(issues).toEqual([]);
    expect(body).toMatchObject({
      name: "Cotton Shirt",
      sku: "SHIRT-1",
      description: "A soft shirt",
      categoryId: "cat1",
      regularPriceMinor: 129900,
      salePriceMinor: 99950,
      wholesalePriceMinor: 80000,
      availability: "active",
      specifications: { Material: "Cotton", Weight: "200g" },
      faqs: [{ q: "Washable?", a: "Yes" }],
      images: [IMAGE],
    });
    expect(body.variants).toEqual(product.variants);
  });

  it("trims text and drops blank optional fields", () => {
    const { body } = prepareProductBody(
      values({ name: "  Tee  ", description: "   ", categoryId: "", salePrice: "", wholesalePrice: " " }),
    );
    expect(body.name).toBe("Tee");
    expect(body).not.toHaveProperty("description");
    expect(body).not.toHaveProperty("categoryId");
    expect(body).not.toHaveProperty("salePriceMinor");
    expect(body).not.toHaveProperty("wholesalePriceMinor");
  });

  it("converts taka text to exact minor units", () => {
    const { body, issues } = prepareProductBody(
      values({ regularPrice: "19.99", salePrice: "10.5", wholesalePrice: "0.07" }),
    );
    expect(issues.map((i) => i.name)).toEqual([]);
    expect(body).toMatchObject({ regularPriceMinor: 1999, salePriceMinor: 1050, wholesalePriceMinor: 7 });
  });

  it("reports invalid and missing prices on the matching fields", () => {
    const { issues } = prepareProductBody(values({ regularPrice: "", salePrice: "12.345", wholesalePrice: "abc" }));
    expect(issues.map((i) => i.name)).toEqual(["regularPrice", "salePrice", "wholesalePrice"]);
    expect(issues[0]!.message).toMatch(/regular price/i);
  });

  it("keeps variant ids, omits blank variant fields and keeps unsaved rows without an id", () => {
    const { body } = prepareProductBody(
      values({
        variants: [
          { id: "v-aaaa", size: " M ", color: "", sku: "" },
          { size: "", color: "Red", sku: " tee-red " },
        ],
      }),
    );
    expect(body.variants).toEqual([{ id: "v-aaaa", size: "M" }, { color: "Red", sku: "tee-red" }]);
  });

  it("drops fully blank specification and FAQ rows", () => {
    const { body, issues } = prepareProductBody(
      values({
        specs: [
          { key: "", value: "" },
          { key: " Colour ", value: " Red " },
        ],
        faqs: [
          { q: "", a: "" },
          { q: " Q? ", a: " A. " },
        ],
      }),
    );
    expect(issues).toEqual([]);
    expect(body.specifications).toEqual({ Colour: "Red" });
    expect(body.faqs).toEqual([{ q: "Q?", a: "A." }]);
  });

  it("flags duplicate and nameless specifications instead of silently merging them", () => {
    const { issues } = prepareProductBody(
      values({
        specs: [
          { key: "Size", value: "1" },
          { key: " Size ", value: "2" },
          { key: "", value: "3" },
        ],
      }),
    );
    expect(issues).toEqual([
      { name: "specs.1.key", message: "This specification name is already used" },
      { name: "specs.2.key", message: "Enter a specification name" },
    ]);
  });

  it("accepts a specification called __proto__ as plain data (and lets the schema refuse it)", () => {
    const { body } = prepareProductBody(values({ specs: [{ key: "__proto__", value: "x" }] }));
    expect(Object.keys(body.specifications as object)).toEqual(["__proto__"]);
    expect(productInputSchema.safeParse(body).success).toBe(false);
  });

  it("produces bodies the create schema accepts", () => {
    const { body } = prepareProductBody(productToFormValues(product));
    expect(productInputSchema.safeParse(body).success).toBe(true);
  });
});

describe("buildProductPatch", () => {
  const initial = prepareProductBody(productToFormValues(product)).body;
  const edit = (patch: Partial<ProductFormValues>) =>
    buildProductPatch(initial, prepareProductBody(values(patch)).body);

  it("is empty when nothing changed", () => {
    expect(edit({})).toEqual({});
  });

  it("sends only the changed fields", () => {
    expect(edit({ name: "Linen Shirt" })).toEqual({ name: "Linen Shirt" });
    expect(edit({ regularPrice: "1500" })).toEqual({ regularPriceMinor: 150000 });
    expect(edit({ availability: "draft" })).toEqual({ availability: "draft" });
    expect(Object.keys(edit({ name: "X", sku: "NEW-1" }))).toEqual(["name", "sku"]);
  });

  it("ignores a SKU that only differs in case (the server upper-cases it)", () => {
    expect(edit({ sku: "shirt-1" })).toEqual({});
  });

  it("sends null for cleared clearable fields", () => {
    expect(edit({ salePrice: "" })).toEqual({ salePriceMinor: null });
    expect(edit({ wholesalePrice: "" })).toEqual({ wholesalePriceMinor: null });
    expect(edit({ description: "  " })).toEqual({ description: null });
    expect(edit({ categoryId: "" })).toEqual({ categoryId: null });
  });

  it("sends the whole variants list, with every existing id, when a variant is added", () => {
    const patch = edit({
      variants: [...values().variants, { size: "XL", color: "", sku: "" }],
    });
    expect(Object.keys(patch)).toEqual(["variants"]);
    expect(patch.variants).toEqual([...product.variants, { size: "XL" }]);
    expect(patch.variants?.slice(0, 2).map((v) => v.id)).toEqual(["v-aaaa", "v-bbbb"]);
  });

  it("keeps ids when an existing variant is edited or one is removed", () => {
    const rows = values().variants;
    expect(edit({ variants: [{ ...rows[0]!, color: "Green" }, rows[1]!] }).variants).toEqual([
      { id: "v-aaaa", size: "M", color: "Green", sku: "SHIRT-1-M" },
      { id: "v-bbbb", size: "L" },
    ]);
    expect(edit({ variants: [rows[1]!] }).variants).toEqual([{ id: "v-bbbb", size: "L" }]);
  });

  it("sends an empty list when every variant is removed", () => {
    expect(edit({ variants: [] })).toEqual({ variants: [] });
  });

  it("sends specifications whole when changed, and {} when cleared", () => {
    expect(edit({ specs: [{ key: "Material", value: "Linen" }, { key: "Weight", value: "200g" }] })).toEqual({
      specifications: { Material: "Linen", Weight: "200g" },
    });
    expect(edit({ specs: [] })).toEqual({ specifications: {} });
  });

  it("does not treat reordered specifications as a change", () => {
    expect(edit({ specs: [{ key: "Weight", value: "200g" }, { key: "Material", value: "Cotton" }] })).toEqual({});
  });

  it("sends FAQs whole when changed, [] when cleared", () => {
    expect(edit({ faqs: [{ q: "Washable?", a: "No" }] })).toEqual({ faqs: [{ q: "Washable?", a: "No" }] });
    expect(edit({ faqs: [] })).toEqual({ faqs: [] });
  });

  it("never sends images that were not changed", () => {
    expect(edit({ name: "X" })).not.toHaveProperty("images");
  });

  it("produces patches the PATCH schema accepts", () => {
    for (const patch of [
      edit({ name: "Y" }),
      edit({ salePrice: "", description: "", categoryId: "" }),
      edit({ variants: [] , specs: [], faqs: [] }),
      edit({ variants: [...values().variants, { size: "XL", color: "", sku: "" }] }),
    ]) {
      expect(productPatchSchema.safeParse(patch).success, JSON.stringify(patch)).toBe(true);
    }
  });
});
