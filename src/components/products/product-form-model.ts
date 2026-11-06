/**
 * Pure logic behind the product editor: form values (prices as taka text), turning them into an
 * API body, and diffing an edit into a minimal PATCH. No React, so it is unit tested directly.
 * Validation against the schema and API error mapping live in `product-form-validation.ts`.
 */
import type { ProductCreateBody, ProductPatchBody } from "@/hooks/use-products";
import { formatMinorToTakaInput, parseTakaToMinor } from "@/lib/money";
import { stableJson } from "@/lib/stable-json";
import type { Availability, Product, ProductImage } from "@/schemas/product";

export interface VariantRow {
  /** Present for a variant that already exists. It MUST be sent back or the variant counts as removed. */
  id?: string;
  size: string;
  color: string;
  sku: string;
}
export interface SpecRow {
  key: string;
  value: string;
}
export interface FaqRow {
  q: string;
  a: string;
}

/** What the form edits. Prices are taka text; `categoryId` is "" for none; images are read-only here. */
export interface ProductFormValues {
  name: string;
  sku: string;
  description: string;
  categoryId: string;
  regularPrice: string;
  salePrice: string;
  wholesalePrice: string;
  availability: Availability;
  variants: VariantRow[];
  specs: SpecRow[];
  faqs: FaqRow[];
  images: ProductImage[];
}

/** A problem tied to a form field (`name` uses react-hook-form paths, e.g. "variants.1.size"). */
export interface FormIssue {
  name: string;
  message: string;
}

export const EMPTY_PRODUCT_VALUES: ProductFormValues = {
  name: "",
  sku: "",
  description: "",
  categoryId: "",
  regularPrice: "",
  salePrice: "",
  wholesalePrice: "",
  availability: "draft",
  variants: [],
  specs: [],
  faqs: [],
  images: [],
};

const price = (minor: number | undefined): string => (minor === undefined ? "" : formatMinorToTakaInput(minor));

export function productToFormValues(p: Product): ProductFormValues {
  return {
    name: p.name,
    sku: p.sku,
    description: p.description ?? "",
    categoryId: p.categoryId ?? "",
    regularPrice: price(p.regularPriceMinor),
    salePrice: price(p.salePriceMinor),
    wholesalePrice: price(p.wholesalePriceMinor),
    availability: p.availability,
    variants: p.variants.map((v) => ({ id: v.id, size: v.size ?? "", color: v.color ?? "", sku: v.sku ?? "" })),
    specs: Object.entries(p.specifications).map(([key, value]) => ({ key, value: String(value) })),
    faqs: p.faqs.map((f) => ({ q: f.q, a: f.a })),
    images: p.images,
  };
}

const text = (v: string | undefined): string | undefined => {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : undefined;
};

function readPrice(raw: string, field: string, label: string, required: boolean, issues: FormIssue[]): number | undefined {
  if (text(raw) === undefined) {
    if (required) issues.push({ name: field, message: `Enter the ${label}` });
    return undefined;
  }
  const result = parseTakaToMinor(raw);
  if (result.ok) return result.minor;
  issues.push({ name: field, message: result.message });
  return undefined;
}

function prepareVariants(rows: readonly VariantRow[]): NonNullable<ProductCreateBody["variants"]> {
  return rows.map((row) => {
    const variant: { id?: string; size?: string; color?: string; sku?: string } = {};
    if (row.id) variant.id = row.id;
    const size = text(row.size);
    const color = text(row.color);
    const sku = text(row.sku);
    if (size) variant.size = size;
    if (color) variant.color = color;
    if (sku) variant.sku = sku;
    return variant;
  });
}

function prepareSpecifications(rows: readonly SpecRow[], issues: FormIssue[]): Record<string, string> {
  const entries: [string, string][] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const key = row.key.trim();
    const value = row.value.trim();
    if (!key && !value) return; // a blank row is just an unused row
    if (!key) return void issues.push({ name: `specs.${index}.key`, message: "Enter a specification name" });
    if (seen.has(key)) {
      return void issues.push({ name: `specs.${index}.key`, message: "This specification name is already used" });
    }
    seen.add(key);
    entries.push([key, value]);
  });
  // fromEntries defines own properties, so a key called "__proto__" stays data (the schema refuses it).
  return Object.fromEntries(entries);
}

/**
 * Trims text, drops blank optional fields and blank repeater rows, converts taka to minor units.
 * `issues` lists what could not be converted (prices, specification names); `body` is only
 * meaningful when it is empty.
 */
export function prepareProductBody(values: ProductFormValues): { body: ProductCreateBody; issues: FormIssue[] } {
  const issues: FormIssue[] = [];
  const regular = readPrice(values.regularPrice, "regularPrice", "regular price", true, issues);
  const sale = readPrice(values.salePrice, "salePrice", "sale price", false, issues);
  const wholesale = readPrice(values.wholesalePrice, "wholesalePrice", "wholesale price", false, issues);
  const specifications = prepareSpecifications(values.specs, issues);

  const body: ProductCreateBody = {
    name: values.name.trim(),
    sku: values.sku.trim(),
    regularPriceMinor: regular ?? 0,
    availability: values.availability,
    images: values.images,
    variants: prepareVariants(values.variants),
    specifications,
    faqs: values.faqs
      .map((f) => ({ q: f.q.trim(), a: f.a.trim() }))
      .filter((f) => f.q.length > 0 || f.a.length > 0),
  };
  const description = text(values.description);
  if (description) body.description = description;
  if (values.categoryId) body.categoryId = values.categoryId;
  if (sale !== undefined) body.salePriceMinor = sale;
  if (wholesale !== undefined) body.wholesalePriceMinor = wholesale;
  return { body, issues };
}

const SCALAR_KEYS = ["name", "regularPriceMinor", "availability"] as const;
const CLEARABLE_KEYS = ["description", "categoryId", "salePriceMinor", "wholesalePriceMinor"] as const;
/** Sent whole (the API replaces them) when they changed. */
const WHOLE_KEYS = ["variants", "specifications", "faqs", "images"] as const;

/**
 * The minimal PATCH body for an edit: only changed fields; cleared clearable fields become
 * `null`; `variants`, `specifications`, `faqs` and `images` are sent whole when they changed
 * (variants keep their ids). Both arguments must come from `prepareProductBody`. The SKU is
 * compared ignoring case because the server upper-cases it.
 */
export function buildProductPatch(initial: ProductCreateBody, next: ProductCreateBody): ProductPatchBody {
  const patch: Record<string, unknown> = {};
  const changed = (key: keyof ProductCreateBody) => stableJson(initial[key]) !== stableJson(next[key]);

  for (const key of SCALAR_KEYS) if (changed(key)) patch[key] = next[key];
  if (initial.sku.toUpperCase() !== next.sku.toUpperCase()) patch.sku = next.sku;
  for (const key of CLEARABLE_KEYS) if (changed(key)) patch[key] = next[key] ?? null;
  for (const key of WHOLE_KEYS) if (changed(key)) patch[key] = next[key];
  return patch as ProductPatchBody;
}
