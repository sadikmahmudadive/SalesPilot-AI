/**
 * Validation of the product form against the create schema, the react-hook-form resolver built
 * on it, and the mapping of API errors onto form fields. Pure (no React components).
 */
import type { FieldErrors, Resolver, UseFormReturn } from "react-hook-form";

import { prepareProductBody, type FormIssue, type ProductFormValues } from "@/components/products/product-form-model";
import type { ProductCreateBody } from "@/hooks/use-products";
import type { ApiError } from "@/lib/api/client";
import { mapApiErrorWith, type MappedApiError } from "@/lib/api/map-error";
import { productInputSchema } from "@/schemas/product";

/** Form field for an API / schema path ("salePriceMinor" -> "salePrice"), or null when it is not an editable field. */
const SCALAR_FIELDS: Readonly<Record<string, string>> = {
  name: "name",
  sku: "sku",
  description: "description",
  categoryId: "categoryId",
  availability: "availability",
  regularPriceMinor: "regularPrice",
  salePriceMinor: "salePrice",
  wholesalePriceMinor: "wholesalePrice",
};
const VARIANT_FIELDS = new Set(["size", "color", "sku"]);
const FAQ_FIELDS = new Set(["q", "a"]);

function toFormField(path: readonly (string | number)[]): string | null {
  const [head, index, field] = path.map(String);
  if (head === undefined) return null;
  if (Object.hasOwn(SCALAR_FIELDS, head)) return path.length === 1 ? SCALAR_FIELDS[head]! : null;
  if (head === "specifications") return "specs";
  if (head === "variants" || head === "faqs") {
    if (index === undefined) return head;
    if (!/^\d+$/.test(index)) return null;
    if (head === "variants") {
      // A row-level problem ("Enter a size or a color") has no field: show it on the first input.
      if (field === undefined) return `variants.${index}.size`;
      return VARIANT_FIELDS.has(field) ? `variants.${index}.${field}` : null; // "id" has no input
    }
    if (field === undefined) return `faqs.${index}.q`;
    return FAQ_FIELDS.has(field) ? `faqs.${index}.${field}` : null;
  }
  return null; // images and anything unknown
}

/** Maps a specification problem to its row when the offending key is known. */
function specRowField(key: string | undefined, values: ProductFormValues, onValue: boolean): string {
  if (key === undefined) return "specs";
  const index = values.specs.findIndex((row) => row.key.trim() === key);
  if (index < 0) return "specs";
  return `specs.${index}.${onValue ? "value" : "key"}`;
}

interface ZodLikeIssue {
  code: string;
  message: string;
  path: PropertyKey[];
  issues?: { message: string }[];
}

/**
 * Validates what the form would send. Returns the body when there are no issues; otherwise the
 * issues, each tied to a form field (conversion problems first, then schema problems).
 */
export function validateProductForm(values: ProductFormValues): { body: ProductCreateBody | null; issues: FormIssue[] } {
  const { body, issues } = prepareProductBody(values);
  const taken = new Set(issues.map((i) => i.name));
  const regularBroken = taken.has("regularPrice");

  const parsed = productInputSchema.safeParse(body);
  if (!parsed.success) {
    for (const issue of parsed.error.issues as unknown as ZodLikeIssue[]) {
      const path = issue.path.map((p) => (typeof p === "symbol" ? String(p.description) : p));
      let name: string | null;
      let message = issue.message;
      if (path[0] === "specifications" && path.length > 1) {
        const isKey = issue.code === "invalid_key";
        if (isKey) message = issue.issues?.[0]?.message ?? message;
        name = specRowField(String(path[1]), values, !isKey);
      } else {
        name = toFormField(path);
      }
      if (name === "salePrice" && regularBroken) continue; // comparing against a price that did not parse
      if (name && taken.has(name)) continue;
      issues.push({ name: name ?? "images", message });
      if (name) taken.add(name);
    }
  }
  return { body: issues.length === 0 ? body : null, issues };
}

/** The react-hook-form instance the editor sections share. */
export type ProductFormApi = UseFormReturn<ProductFormValues>;

type Leaf = { type: string; message: string };
const LIST_ROOTS = new Set(["variants", "specs", "faqs"]);

/** Builds the nested object react-hook-form expects (`errors.variants[1].size`, `errors.variants.root`). */
export function toFieldErrors(issues: readonly FormIssue[]): FieldErrors<ProductFormValues> {
  const root: Record<string, unknown> = {};
  for (const { name, message } of issues) {
    const parts = LIST_ROOTS.has(name) ? [name, "root"] : name.split(".");
    let node: Record<string, unknown> = root;
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      if (last) {
        node[part] = { type: "validate", message } satisfies Leaf;
        return;
      }
      const nextIsIndex = /^\d+$/.test(parts[i + 1]!);
      const existing = node[part];
      node[part] ??= nextIsIndex || parts[i + 1] === "root" ? [] : {};
      node = (existing ?? node[part]) as Record<string, unknown>;
    });
  }
  return root as FieldErrors<ProductFormValues>;
}

/** The message stored at a path such as "variants.1.size" or "variants.root", if any. */
export function errorMessageAt(errors: unknown, path: string): string | undefined {
  let node: unknown = errors;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  const message = (node as { message?: unknown } | undefined)?.message;
  return typeof message === "string" ? message : undefined;
}

/** react-hook-form resolver: validates the converted body, so error paths match the API's. */
export const productResolver: Resolver<ProductFormValues> = (values) => {
  const { issues } = validateProductForm(values);
  return issues.length > 0 ? { values: {}, errors: toFieldErrors(issues) } : { values, errors: {} };
};

export type MappedProductError = MappedApiError;

const SKU_CONFLICT = /\bsku\b/i;
export const DUPLICATE_SKU_MESSAGE = "A product with this SKU already exists";

/**
 * Turns a failed save into per-field errors plus (at most) one banner message. A 409 about the SKU
 * lands on the SKU field; every other 409 (variant with stock, concurrent change) is a banner.
 */
export function mapProductApiError(error: ApiError): MappedProductError {
  return mapApiErrorWith(error, {
    toField: (path) => toFormField(path.split(".")),
    onConflict: (e) =>
      SKU_CONFLICT.test(e.message)
        ? { fields: [{ name: "sku", message: DUPLICATE_SKU_MESSAGE }], formError: null }
        : { fields: [], formError: e.message },
  });
}
