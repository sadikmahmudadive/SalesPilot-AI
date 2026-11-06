/**
 * Pins the most damaging failure mode of the editor: a saved variant losing its `id` while rows are
 * added, removed or the form is reset. A PATCH without ids makes the server treat every variant as
 * removed (and new), which fails when they hold stock.
 *
 * Runs react-hook-form's real `useFieldArray` (the same call the variant editor makes, with
 * `keyName: "_key"`) against a real form control, without a DOM: the hook is rendered once with
 * react-dom/server to obtain its action functions, which only touch the control and refs. The one
 * internal touched is the "mounted" flag that `useForm`'s mount effect would set.
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createFormControl, useFieldArray } from "react-hook-form";
import { describe, expect, it } from "vitest";

import {
  prepareProductBody,
  productToFormValues,
  type ProductFormValues,
  type VariantRow,
} from "@/components/products/product-form-model";
import type { Product } from "@/schemas/product";

const product: Product = {
  id: "p1",
  organizationId: "o1",
  slug: "tee",
  archived: false,
  name: "Tee",
  sku: "TEE-1",
  images: [],
  variants: [
    { id: "v-aaaa", size: "M", color: "Blue" },
    { id: "v-bbbb", size: "L" },
    { id: "v-cccc", size: "XL", sku: "TEE-1-XL" },
  ],
  regularPriceMinor: 50000,
  availability: "active",
  specifications: {},
  faqs: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function mount(values: ProductFormValues) {
  const form = createFormControl<ProductFormValues>({ defaultValues: values });
  type Api = ReturnType<typeof useFieldArray<ProductFormValues, "variants", "_key">>;
  let api!: Api;
  function Harness() {
    api = useFieldArray({ control: form.control, name: "variants", keyName: "_key" });
    // The editor registers each row's inputs; do the same so the control tracks the rows as in the UI.
    values.variants.forEach((_, i) => {
      form.register(`variants.${i}.size`);
      form.register(`variants.${i}.color`);
      form.register(`variants.${i}.sku`);
    });
    return null;
  }
  renderToString(createElement(Harness));
  // useForm's mount effect does this (effects do not run in a server render); until then the
  // control reads and writes the default values instead of the live ones.
  form.control._state.mount = true;
  const rows = (): VariantRow[] => form.getValues().variants;
  return { form, api, rows };
}

const ids = (rows: readonly VariantRow[]) => rows.map((r) => r.id);
const blank: VariantRow = { size: "S", color: "", sku: "" };

describe("variant ids in the product form", () => {
  it("start with every saved variant's id", () => {
    const { rows } = mount(productToFormValues(product));
    expect(ids(rows())).toEqual(["v-aaaa", "v-bbbb", "v-cccc"]);
  });

  it("survive appending a row, which itself has no id", () => {
    const { api, rows } = mount(productToFormValues(product));
    api.append(blank);
    expect(ids(rows())).toEqual(["v-aaaa", "v-bbbb", "v-cccc", undefined]);
    expect(rows()[3]).not.toHaveProperty("id");
  });

  it("survive removing a row, staying attached to the right variants", () => {
    const { api, rows } = mount(productToFormValues(product));
    api.remove(1);
    expect(ids(rows())).toEqual(["v-aaaa", "v-cccc"]);
    expect(rows().map((r) => r.size)).toEqual(["M", "XL"]);
  });

  it("survive a mix of removes and appends", () => {
    const { api, rows } = mount(productToFormValues(product));
    api.remove(0);
    api.append(blank);
    api.remove(0);
    api.append({ ...blank, size: "XS" });
    expect(ids(rows())).toEqual(["v-cccc", undefined, undefined]);
    expect(rows().map((r) => r.size)).toEqual(["XL", "S", "XS"]);
  });

  it("survive reset to the values returned by a save", () => {
    const { api, form, rows } = mount(productToFormValues(product));
    api.append(blank);
    // The server assigns an id to the new variant; the form is reset with the saved product.
    const saved: Product = { ...product, variants: [...product.variants, { id: "v-dddd", size: "S" }] };
    form.reset(productToFormValues(saved));
    expect(ids(rows())).toEqual(["v-aaaa", "v-bbbb", "v-cccc", "v-dddd"]);
  });

  it("reach the request body, so the server keeps those variants", () => {
    const { api, form } = mount(productToFormValues(product));
    api.remove(1);
    api.append(blank);
    const { body, issues } = prepareProductBody(form.getValues());
    expect(issues).toEqual([]);
    expect(body.variants).toEqual([
      { id: "v-aaaa", size: "M", color: "Blue" },
      { id: "v-cccc", size: "XL", sku: "TEE-1-XL" },
      { size: "S" },
    ]);
  });
});
