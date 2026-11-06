import { describe, expect, it } from "vitest";

import { productToFormValues, type ProductFormValues } from "@/components/products/product-form-model";
import {
  errorMessageAt,
  mapProductApiError,
  toFieldErrors,
  validateProductForm,
} from "@/components/products/product-form-validation";
import { ApiError } from "@/lib/api/client";
import type { Product } from "@/schemas/product";

const product: Product = {
  id: "p1",
  organizationId: "o1",
  slug: "tee",
  archived: false,
  name: "Tee",
  sku: "TEE-1",
  images: [],
  variants: [{ id: "v-1", size: "M" }],
  regularPriceMinor: 50000,
  availability: "active",
  specifications: {},
  faqs: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const values = (patch: Partial<ProductFormValues> = {}): ProductFormValues => ({
  ...productToFormValues(product),
  ...patch,
});

const names = (v: ProductFormValues) => validateProductForm(v).issues.map((i) => i.name);

describe("validateProductForm", () => {
  it("accepts a valid product and returns the body", () => {
    const r = validateProductForm(values());
    expect(r.issues).toEqual([]);
    expect(r.body?.regularPriceMinor).toBe(50000);
  });

  it("requires a name and a valid SKU", () => {
    expect(names(values({ name: "  ", sku: "bad sku!" }))).toEqual(["name", "sku"]);
  });

  it("maps price fields back to the form's taka fields", () => {
    expect(names(values({ regularPrice: "" }))).toEqual(["regularPrice"]);
    expect(names(values({ regularPrice: "100", salePrice: "150" }))).toEqual(["salePrice"]);
    expect(validateProductForm(values({ regularPrice: "100", salePrice: "150" })).issues[0]!.message).toMatch(
      /sale price/i,
    );
  });

  it("checks sale <= regular using exact minor units", () => {
    expect(names(values({ regularPrice: "19.99", salePrice: "19.99" }))).toEqual([]);
    expect(names(values({ regularPrice: "19.99", salePrice: "20" }))).toEqual(["salePrice"]);
  });

  it("points variant problems at the row", () => {
    const rows = [
      { id: "v-1", size: "M", color: "", sku: "" },
      { size: "", color: "", sku: "" },
      { size: "L", color: "", sku: "no good!" },
    ];
    expect(names(values({ variants: rows }))).toEqual(["variants.1.size", "variants.2.sku"]);
  });

  it("points FAQ problems at the row and field", () => {
    // A row with only one side filled is invalid; a fully blank row is dropped.
    expect(names(values({ faqs: [{ q: "Q?", a: "A" }, { q: "Only a question", a: "" }] }))).toEqual(["faqs.1.a"]);
    expect(names(values({ faqs: [{ q: "", a: "" }] }))).toEqual([]);
    expect(names(values({ faqs: [{ q: "Q?", a: "" }] }))).toEqual(["faqs.0.a"]);
    expect(names(values({ faqs: [{ q: "", a: "A" }] }))).toEqual(["faqs.0.q"]);
  });

  it("points a too-long specification value at the row", () => {
    expect(names(values({ specs: [{ key: "Note", value: "x".repeat(301) }] }))).toEqual(["specs.0.value"]);
  });

  it("points an invalid specification name at its row, with the schema's message", () => {
    const r = validateProductForm(values({ specs: [{ key: "x".repeat(61), value: "1" }, { key: "a.b", value: "2" }] }));
    expect(r.issues).toEqual([
      { name: "specs.0.key", message: "Use 60 characters or fewer" },
      { name: "specs.1.key", message: "This specification name is not allowed" },
    ]);
  });

  it("returns no body while there are issues", () => {
    expect(validateProductForm(values({ name: "" })).body).toBeNull();
  });
});

describe("toFieldErrors and errorMessageAt", () => {
  const errors = toFieldErrors([
    { name: "name", message: "Enter the product name" },
    { name: "variants.1.size", message: "Enter a size or a color" },
    { name: "variants", message: "Use at most 50 variants" },
    { name: "specs", message: "Too many" },
  ]);

  it("nests errors the way react-hook-form reads them", () => {
    expect(errors.name).toMatchObject({ type: "validate", message: "Enter the product name" });
    expect(errorMessageAt(errors, "variants.1.size")).toBe("Enter a size or a color");
    expect(errorMessageAt(errors, "variants.0.size")).toBeUndefined();
    expect(errorMessageAt(errors, "name")).toBe("Enter the product name");
  });

  it("keeps a list-level message separate from its rows", () => {
    expect(errorMessageAt(errors, "variants.root")).toBe("Use at most 50 variants");
    expect(errorMessageAt(errors, "specs.root")).toBe("Too many");
  });
});

describe("mapProductApiError", () => {
  const api = (init: Partial<ConstructorParameters<typeof ApiError>[0]>) =>
    new ApiError({ status: 400, code: "VALIDATION_ERROR", message: "Invalid request", ...init });

  it("maps a duplicate SKU conflict onto the sku field", () => {
    const r = mapProductApiError(api({ status: 409, code: "CONFLICT", message: "A product with this SKU already exists" }));
    expect(r.fields).toEqual([{ name: "sku", message: "A product with this SKU already exists" }]);
    expect(r.formError).toBeNull();
  });

  it("shows other conflicts (variant with stock, busy) as a banner with the server message", () => {
    const stock = mapProductApiError(
      api({
        status: 409,
        code: "CONFLICT",
        message: "Variants that have stock or reservations cannot be removed or replaced",
        requestId: "r-1",
      }),
    );
    expect(stock.fields).toEqual([]);
    expect(stock.formError).toMatch(/stock or reservations/);
    expect(stock.requestId).toBe("r-1");
    const busy = mapProductApiError(
      api({ status: 409, code: "CONFLICT", message: "The product could not be saved because of a concurrent change; please try again" }),
    );
    expect(busy.fields).toEqual([]);
    expect(busy.formError).toMatch(/concurrent change/);
  });

  it("maps validation details onto form fields", () => {
    const r = mapProductApiError(
      api({
        details: [
          { path: "regularPriceMinor", message: "Enter a whole number of paisa (0 or more)" },
          { path: "salePriceMinor", message: "The sale price cannot be higher than the regular price" },
          { path: "variants.2.sku", message: "Use letters, numbers" },
          { path: "variants.0", message: "Enter a size or a color" },
          { path: "specifications", message: "Use at most 30 specifications" },
          { path: "faqs.1.a", message: "Enter the answer" },
          { path: "categoryId", message: "Choose a valid category" },
        ],
      }),
    );
    expect(r.fields.map((f) => f.name)).toEqual([
      "regularPrice",
      "salePrice",
      "variants.2.sku",
      "variants.0.size",
      "specs",
      "faqs.1.a",
      "categoryId",
    ]);
    expect(r.formError).toBeNull();
  });

  it("sends images and unknown paths to the banner", () => {
    const r = mapProductApiError(
      api({ details: [{ path: "images.0.url", message: "Use an image uploaded through the product image uploader" }, { path: "body", message: "Bad" }] }),
    );
    expect(r.fields).toEqual([]);
    expect(r.formError).toMatch(/image uploader/);
  });

  it("gives friendly messages for 401 and 403", () => {
    expect(mapProductApiError(api({ status: 401, code: "UNAUTHENTICATED" })).formError).toMatch(/sign in/i);
    expect(mapProductApiError(api({ status: 403, code: "FORBIDDEN" })).formError).toMatch(/permission/i);
  });
});
