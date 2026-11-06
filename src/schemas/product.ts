/**
 * Product and category schemas. Pure (shared by API routes, services and, later, the UI).
 *
 * MONEY. Prices are integer minor units (paisa), never floats: `regularPriceMinor` is an
 * integer in 0..1_000_000_000 and `salePriceMinor` / `wholesalePriceMinor` follow the same
 * bounds. A sale price may not exceed the regular price (checked here when both are present,
 * and by the service against the merged result for a PATCH that sets only one of them).
 *
 * MANAGED FIELDS. `slug`, `archived`, `id`, `organizationId`, `createdAt`, `updatedAt`,
 * `nameLower` and `skuLower` are never read from a client: object schemas strip unknown keys,
 * and the service computes them.
 *
 * Source hygiene: no literal non-ASCII characters in this file.
 */
import { z } from "zod";

import { isValidIdSegment } from "@/lib/ids";
import { cleanName, isBlank } from "@/lib/text";

import { clearable, dropUndefined, omitWhenBlank } from "./helpers";

export const AVAILABILITIES = ["active", "draft", "archived"] as const;
export type Availability = (typeof AVAILABILITIES)[number];

export const MAX_PRICE_MINOR = 1_000_000_000;
export const MAX_IMAGES = 10;
export const MAX_VARIANTS = 50;
export const MAX_SPECIFICATIONS = 30;
export const MAX_FAQS = 20;
/** Reserved inventory variant id for products without variants. */
export const DEFAULT_VARIANT_ID = "default";

/** The only image host products may reference (Cloudinary delivery URLs). */
export const IMAGE_HOST = "res.cloudinary.com";
/** Cloudinary public id folder every product image of `orgId` must live under. */
export const productImagePrefix = (orgId: string): string => `organizations/${orgId}/products/`;

const NAME_MESSAGE = "Enter the product name";
const SKU_MESSAGE = "Use letters, numbers, dots, dashes and underscores (up to 64 characters)";
const PRICE_MESSAGE = "Enter a whole number of paisa (0 or more)";

const price = z
  .number({ error: PRICE_MESSAGE })
  .int({ error: PRICE_MESSAGE })
  .min(0, { error: PRICE_MESSAGE })
  .max(MAX_PRICE_MINOR, { error: PRICE_MESSAGE });

/**
 * SKU: trimmed, then upper-cased. The charset is checked BEFORE upper-casing, so characters that
 * upper-case into the allowed set (dotless i, long s) are rejected rather than silently folded.
 * "/" is deliberately NOT allowed: the SKU is part of the lock document id `{org}_{sku}`, and a
 * slash would turn it into a different path.
 */
const skuCore = z
  .string({ error: SKU_MESSAGE })
  .max(200, { error: SKU_MESSAGE })
  .transform((v) => v.trim())
  .pipe(
    z
      .string()
      .min(1, { error: SKU_MESSAGE })
      .max(64, { error: SKU_MESSAGE })
      .regex(/^[A-Za-z0-9._-]+$/, { error: SKU_MESSAGE }),
  )
  .transform((v) => v.toUpperCase());

const nameCore = z
  .string({ error: NAME_MESSAGE })
  .max(1000, "Use 200 characters or fewer")
  .transform(cleanName)
  .pipe(
    z
      .string()
      .min(1, NAME_MESSAGE)
      .max(200, "Use 200 characters or fewer")
      .refine((v) => !isBlank(v), { error: NAME_MESSAGE }),
  );

const descriptionCore = z.string().trim().max(5000, "Use 5000 characters or fewer");
const categoryIdCore = z
  .string()
  .refine((v) => isValidIdSegment(v), { error: "Choose a valid category" });

// ---- images ----------------------------------------------------------------------------------

const IMAGE_MESSAGE = "Use an image uploaded through the product image uploader";
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_\-/]*$/;
const CLOUD_PATH_CLOUD = /^\/([A-Za-z0-9_-]+)\/image\/upload\//;
const CLOUD_PATH = /^\/[A-Za-z0-9_-]+\/image\/upload\/(?:v\d+\/)?(.+)$/;
const EXTENSION = /^[A-Za-z0-9]{1,8}$/;

function parseImageUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * The Cloudinary cloud name of a delivery URL (first path segment), or null when `raw` is not an
 * `https://res.cloudinary.com/{cloud}/image/upload/...` URL. The schema cannot bind the cloud to
 * this deployment (it is imported by client code); the service does, see `normalizeImages`.
 */
export function imageCloudName(raw: string): string | null {
  const url = parseImageUrl(raw);
  if (!url || url.protocol !== "https:" || url.hostname !== IMAGE_HOST) return null;
  return CLOUD_PATH_CLOUD.exec(url.pathname)?.[1] ?? null;
}

/** Does `url` point at the Cloudinary asset `publicId` (no transformations, https, no extras)? */
export function urlMatchesPublicId(raw: string, publicId: string): boolean {
  const url = parseImageUrl(raw);
  if (!url) return false;
  if (url.protocol !== "https:" || url.hostname !== IMAGE_HOST) return false;
  if (url.port !== "" || url.username !== "" || url.password !== "") return false;
  if (url.search !== "" || url.hash !== "") return false;
  const rest = CLOUD_PATH.exec(url.pathname)?.[1];
  if (rest === undefined) return false;
  if (rest === publicId) return true;
  return rest.startsWith(`${publicId}.`) && EXTENSION.test(rest.slice(publicId.length + 1));
}

const dimension = z.number({ error: "Invalid image size" }).int().min(1).max(20000);

const imageSchema = z
  .object({
    url: z.string({ error: IMAGE_MESSAGE }).max(2048, { error: IMAGE_MESSAGE }),
    publicId: z
      .string({ error: IMAGE_MESSAGE })
      .min(1, { error: IMAGE_MESSAGE })
      .max(255, { error: IMAGE_MESSAGE })
      .regex(PUBLIC_ID_PATTERN, { error: IMAGE_MESSAGE })
      .refine((v) => !v.includes("//") && !v.split("/").some((s) => s === "." || s === ".."), {
        error: IMAGE_MESSAGE,
      }),
    width: dimension,
    height: dimension,
  })
  // The URL must be the https Cloudinary URL of exactly this publicId: otherwise a client could
  // pair an allowed publicId (ownership is checked on it) with the URL of someone else's asset.
  .refine((img) => urlMatchesPublicId(img.url, img.publicId), {
    path: ["url"],
    error: IMAGE_MESSAGE,
  });

export type ProductImage = z.output<typeof imageSchema>;

// ---- variants --------------------------------------------------------------------------------

/** Variant ids: lower-case letters, digits and dashes, 1-40 characters (also used for inventory ids). */
export const VARIANT_ID_PATTERN = /^[a-z0-9-]{1,40}$/;
const variantAttr = z.string().trim().max(40, "Use 40 characters or fewer");

const variantSchema = z
  .object({
    id: z
      .string({ error: "Invalid variant id" })
      .regex(VARIANT_ID_PATTERN, { error: "Invalid variant id" })
      .refine((v) => v !== DEFAULT_VARIANT_ID, { error: "Invalid variant id" })
      .optional(),
    size: omitWhenBlank(variantAttr, "Enter a valid size"),
    color: omitWhenBlank(variantAttr, "Enter a valid color"),
    sku: omitWhenBlank(skuCore, SKU_MESSAGE),
  })
  .transform((v) => dropUndefined(v))
  .refine((v) => v.size !== undefined || v.color !== undefined, {
    error: "Enter a size or a color",
  });

/** A variant as stored: the server always assigns the id. */
export interface ProductVariant {
  id: string;
  size?: string;
  color?: string;
  sku?: string;
}

const variantsSchema = z
  .array(variantSchema, { error: "Variants must be a list" })
  .max(MAX_VARIANTS, `Use at most ${MAX_VARIANTS} variants`)
  .refine(
    (list) => {
      const ids = list.map((v) => v.id).filter((id): id is string => id !== undefined);
      return new Set(ids).size === ids.length;
    },
    { error: "Variant ids must be unique" },
  );

// ---- specifications and faqs -----------------------------------------------------------------

const FORBIDDEN_SPEC_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

const specKey = z
  .string()
  .trim()
  .min(1, "Specification names cannot be empty")
  .max(60, "Use 60 characters or fewer")
  .refine(
    (k) =>
      !FORBIDDEN_SPEC_KEYS.has(k) &&
      !k.includes(".") &&
      !k.includes("/") &&
      // Firestore reserves field names of the form __name__.
      !(k.startsWith("__") && k.endsWith("__")),
    { error: "This specification name is not allowed" },
  );

/**
 * Pre-parse guard for the specifications object. Zod's record parser silently DROPS an own
 * `__proto__` key instead of reporting it, so forbidden names are rejected here, before it runs.
 * Also bounds the entry count (so an enormous object is never walked) and rejects two keys that
 * only differ by surrounding whitespace (they would silently overwrite each other).
 */
function isAcceptableSpecifications(v: unknown): boolean {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  if (keys.length > MAX_SPECIFICATIONS) return false;
  const trimmed = keys.map((k) => k.trim());
  return (
    trimmed.every((k) => !FORBIDDEN_SPEC_KEYS.has(k)) && new Set(trimmed).size === trimmed.length
  );
}

const specificationsSchema = z
  .custom<Record<string, unknown>>(isAcceptableSpecifications, {
    error: `Use at most ${MAX_SPECIFICATIONS} specifications with allowed names`,
  })
  .pipe(
    z.record(
      specKey,
      z.string({ error: "Invalid value" }).trim().max(300, "Use 300 characters or fewer"),
    ),
  );

const faqsSchema = z
  .array(
    z.object({
      q: z
        .string({ error: "Enter the question" })
        .trim()
        .min(1, "Enter the question")
        .max(200, "Use 200 characters or fewer"),
      a: z
        .string({ error: "Enter the answer" })
        .trim()
        .min(1, "Enter the answer")
        .max(1000, "Use 1000 characters or fewer"),
    }),
    { error: "FAQs must be a list" },
  )
  .max(MAX_FAQS, `Use at most ${MAX_FAQS} FAQs`);

// ---- product ---------------------------------------------------------------------------------

const availabilitySchema = z.enum(AVAILABILITIES, { error: "Choose an availability" });

/** Rules shared verbatim by create and PATCH. None of them carries a default. */
const sharedFields = {
  name: nameCore,
  sku: skuCore,
  categoryId: categoryIdCore,
  images: z
    .array(imageSchema, { error: "Images must be a list" })
    .max(MAX_IMAGES, `Use at most ${MAX_IMAGES} images`)
    .refine((list) => new Set(list.map((i) => i.publicId)).size === list.length, {
      error: "Each image can be attached only once",
    }),
  variants: variantsSchema,
  regularPriceMinor: price,
  availability: availabilitySchema,
  specifications: specificationsSchema,
  faqs: faqsSchema,
};

const SALE_MESSAGE = "The sale price cannot be higher than the regular price";

/**
 * Create body. Applies defaults (draft, no images / variants / specifications / FAQs), trims and
 * upper-cases the SKU, omits a blank description and unknown keys. `null` is rejected.
 */
export const productInputSchema = z
  .object({
    name: sharedFields.name,
    sku: sharedFields.sku,
    description: omitWhenBlank(descriptionCore, "Enter a description"),
    categoryId: sharedFields.categoryId.optional(),
    images: sharedFields.images.default([]),
    variants: sharedFields.variants.default([]),
    regularPriceMinor: sharedFields.regularPriceMinor,
    salePriceMinor: price.optional(),
    wholesalePriceMinor: price.optional(),
    availability: sharedFields.availability.default("draft"),
    specifications: sharedFields.specifications.default({}),
    faqs: sharedFields.faqs.default([]),
  })
  .refine((v) => v.salePriceMinor === undefined || v.salePriceMinor <= v.regularPriceMinor, {
    path: ["salePriceMinor"],
    error: SALE_MESSAGE,
  })
  .transform((v) => dropUndefined(v));

/**
 * PATCH body. Every field optional, NO defaults, so patching `{ name }` yields exactly
 * `{ name }`. `salePriceMinor`, `wholesalePriceMinor`, `categoryId` and `description` are
 * clearable: `null` (or a blank description) parses to `null`, which the service maps to
 * `FieldValue.delete()`. An empty patch (after stripping unknown keys) is rejected. When both
 * prices are present the sale price is checked here; when only one is, the service checks the
 * merged result.
 */
export const productPatchSchema = z
  .object({
    name: sharedFields.name,
    sku: sharedFields.sku,
    description: clearable(descriptionCore),
    categoryId: clearable(categoryIdCore),
    images: sharedFields.images,
    variants: sharedFields.variants,
    regularPriceMinor: sharedFields.regularPriceMinor,
    salePriceMinor: price.nullable(),
    wholesalePriceMinor: price.nullable(),
    availability: sharedFields.availability,
    specifications: sharedFields.specifications,
    faqs: sharedFields.faqs,
  })
  .partial()
  .transform((v) => dropUndefined(v))
  .refine((v) => Object.keys(v).length > 0, { error: "At least one field is required" })
  .refine(
    (v) =>
      v.salePriceMinor === undefined ||
      v.salePriceMinor === null ||
      v.regularPriceMinor === undefined ||
      v.salePriceMinor <= v.regularPriceMinor,
    { path: ["salePriceMinor"], error: SALE_MESSAGE },
  );

export type ProductInput = z.output<typeof productInputSchema>;
export type ProductPatch = z.output<typeof productPatchSchema>;

/** A persisted product (service-computed `nameLower` / `skuLower` are not part of it). */
export type Product = Omit<ProductInput, "variants"> & {
  id: string;
  organizationId: string;
  /** Derived from the name when the product is created and stable afterwards. */
  slug: string;
  /** True exactly when `availability` is "archived". */
  archived: boolean;
  variants: ProductVariant[];
  createdAt: string;
  updatedAt: string;
};

// ---- category --------------------------------------------------------------------------------

export const categoryInputSchema = z
  .object({
    name: z
      .string({ error: "Enter the category name" })
      .max(1000, "Use 80 characters or fewer")
      .transform(cleanName)
      .pipe(
        z
          .string()
          .min(1, "Enter the category name")
          .max(80, "Use 80 characters or fewer")
          .refine((v) => !isBlank(v), { error: "Enter the category name" }),
      ),
    description: omitWhenBlank(
      z.string().trim().max(500, "Use 500 characters or fewer"),
      "Enter a description",
    ),
  })
  .transform((v) => dropUndefined(v));

export type CategoryInput = z.output<typeof categoryInputSchema>;

export interface Category extends CategoryInput {
  id: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}
