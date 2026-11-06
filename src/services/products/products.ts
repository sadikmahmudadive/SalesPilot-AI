/**
 * Product service: tenant-scoped create / read / update / archive / list with SKU and slug
 * uniqueness, inventory stubs and audit. Server-only.
 *
 * TENANCY. Every function takes `ctx = { organizationId, uid }`, derived by the route wrapper
 * from the verified session + membership document, never from client input. Reads and writes go
 * through `productRepo` / transactions that compare the stored `organizationId`; a product in
 * another organization behaves exactly like a missing one (NotFoundError). A category id must
 * resolve to a category of the SAME organization, and every image `publicId` must live under
 * `organizations/{organizationId}/products/`, so a client cannot attach another tenant's data.
 *
 * UNIQUENESS. A SKU is unique per organization through `productSkus/{organizationId}_{SKU}` and a
 * slug through `productSlugs/{organizationId}_{slug}`. Locks are written in the SAME transaction
 * as the product (create), the SKU lock is moved in the same transaction as a SKU change
 * (update), and locks are NEVER released: archiving keeps the SKU and slug reserved because
 * orders and shared links keep pointing at the product.
 *   - create issues no transactional reads for the locks: it uses `tx.create` so concurrent
 *     creates do not contend on read locks and exactly one commit wins (ALREADY_EXISTS for the
 *     rest). Slug candidates (`slug`, `slug-2` ... `slug-20`) and the SKU are probed with one
 *     plain batch read just before the transaction; if the commit still loses a race (an
 *     ALREADY_EXISTS the probe could not see), the whole attempt is repeated, so the next probe
 *     reports the real winner: a taken SKU becomes a ConflictError, a taken slug moves on to the
 *     next suffix. The commit-time existence check is what guarantees uniqueness; the probe only
 *     chooses the slug and gives a clean error.
 *   - SLUGS ARE STABLE. A slug is derived from the name once, when the product is created, and
 *     never changes (renaming a product does not touch it) because URLs and links must not
 *     break. The SKU, in contrast, can be changed and its lock moves.
 *
 * INVENTORY. `inventory/{productId}__{variantId}` documents (`variantId = "default"` for a product
 * without variants) are created in the product-create transaction with zero counters, and
 * `updateProduct` keeps them in step with the variant list in the same transaction. Rule: a
 * variant (or the `default` unit) can only be removed while its inventory document has no stock
 * (`onHand`, `reserved`, `available` all 0) and no reservation records; otherwise ConflictError.
 * A zero-stock document of a removed variant is deleted. This also covers the transitions
 * "no variants -> variants" (the `default` unit is removed, so it must be empty) and the reverse.
 * `variants` in a PATCH REPLACES the list: variants are matched by `id`, so a client must echo
 * the ids of the variants it keeps; a variant sent without an id is a NEW variant.
 *
 * INVARIANT. `archived === (availability === "archived")`. `archiveProduct` and a PATCH of
 * `availability` both maintain it; clients can never send `archived`.
 *
 * AUDIT. Rows are written in the same transaction (a failing audit write persists nothing). They
 * hold ids, the NAMES of changed fields and a few business values (SKU, availability, prices,
 * category id); never descriptions, FAQs, specifications or image data.
 */
import "server-only";

import { randomUUID } from "node:crypto";

import { FieldValue, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";

import { ConflictError, NotFoundError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { isAlreadyExists } from "@/lib/firestore-errors";
import { isValidIdSegment } from "@/lib/ids";
import { writeAuditInTransaction } from "@/lib/security/audit";
import { baseSlug, slugCandidates } from "@/lib/slug";
import { invalid } from "@/lib/validation-error";
import { categoryRepo } from "@/repositories/categories";
import {
  buildProduct,
  inventoryRef,
  isValidSkuKey,
  newInventoryData,
  productRepo,
  skuLockRef,
  slugLockRef,
  trySkuLockRef,
  type ProductDoc,
} from "@/repositories/products";
import {
  DEFAULT_VARIANT_ID,
  MAX_PRICE_MINOR,
  productImagePrefix,
  urlMatchesPublicId,
  type Product,
  type ProductInput,
  type ProductPatch,
  type ProductVariant,
} from "@/schemas/product";

import { buildListPlan, nameLowerKey, skuLowerKey, type ProductListQuery } from "./product-query";

export type { ProductListQuery } from "./product-query";

export interface ProductCtx {
  organizationId: string;
  uid: string;
}

export interface ProductPage {
  items: Product[];
  nextCursor: string | null;
}

const DUPLICATE_SKU_MESSAGE = "A product with this SKU already exists";
const SLUG_EXHAUSTED_MESSAGE = "Could not generate a unique URL for this product; change the name";
const BUSY_MESSAGE =
  "The product could not be saved because of a concurrent change; please try again";
const VARIANT_STOCK_MESSAGE =
  "Variants that have stock or reservations cannot be removed or replaced";
const CREATE_ATTEMPTS = 5;

/** Fields copied from client input (everything else is dropped). */
const INPUT_KEYS = [
  "name",
  "sku",
  "description",
  "categoryId",
  "images",
  "variants",
  "regularPriceMinor",
  "salePriceMinor",
  "wholesalePriceMinor",
  "availability",
  "specifications",
  "faqs",
] as const;
/** Fields a PATCH may clear with `null`. Clearing removes the field from the document. */
const CLEARABLE = new Set<string>([
  "salePriceMinor",
  "wholesalePriceMinor",
  "categoryId",
  "description",
]);

type Fields = Record<string, unknown>;

export function assertCtx(ctx: ProductCtx): void {
  // Fail closed: a missing organization must never reach a query.
  if (
    !ctx ||
    !isValidIdSegment(ctx.organizationId) ||
    typeof ctx.uid !== "string" ||
    ctx.uid.trim() === ""
  ) {
    throw new Error("Product service requires an organization and user context");
  }
}

/** Invalid ids get the same NotFound as missing ones, so ids cannot be probed. */
function assertProductId(id: unknown): asserts id is string {
  if (!isValidIdSegment(id)) throw new NotFoundError();
}

/** Public shape: the stored document minus the service-internal keys. */
function toProduct(doc: ProductDoc): Product {
  const copy: Partial<ProductDoc> = { ...doc };
  delete copy.nameLower;
  delete copy.skuLower;
  return copy as Product;
}

const AUDIT_VALUE_KEYS = [
  "sku",
  "availability",
  "regularPriceMinor",
  "salePriceMinor",
  "wholesalePriceMinor",
  "categoryId",
] as const;

/** The only product values an audit row may carry (no free text). */
function auditValues(fields: Fields): Fields {
  const out: Fields = {};
  for (const key of AUDIT_VALUE_KEYS) {
    if (fields[key] !== undefined) out[key] = fields[key];
  }
  return out;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Fields)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

// ---- input normalisation -----------------------------------------------------------------

function newVariantId(): string {
  return `v-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

/** Copies only known variant keys and assigns a server-side id to every variant without one. */
function normalizeVariants(raw: unknown): ProductVariant[] {
  if (!Array.isArray(raw)) throw invalid("variants", "Variants must be a list");
  const used = new Set<string>();
  for (const v of raw as Fields[]) {
    if (typeof v?.id === "string") {
      if (used.has(v.id)) throw invalid("variants", "Variant ids must be unique");
      used.add(v.id);
    }
  }
  return (raw as Fields[]).map((v) => {
    let id = v.id;
    if (typeof id !== "string") {
      do id = newVariantId();
      while (used.has(id as string));
      used.add(id as string);
    }
    if (!/^[a-z0-9-]{1,40}$/.test(id as string) || id === DEFAULT_VARIANT_ID) {
      throw invalid("variants", "Invalid variant id");
    }
    const out: ProductVariant = { id: id as string };
    if (typeof v.size === "string") out.size = v.size;
    if (typeof v.color === "string") out.color = v.color;
    if (typeof v.sku === "string") out.sku = v.sku;
    return out;
  });
}

/** Image ownership: only the caller's own organization folder, and only exact Cloudinary URLs. */
function normalizeImages(orgId: string, raw: unknown): Fields[] {
  if (!Array.isArray(raw)) throw invalid("images", "Images must be a list");
  const prefix = productImagePrefix(orgId);
  return (raw as Fields[]).map((img) => {
    const { url, publicId, width, height } = img ?? {};
    if (
      typeof url !== "string" ||
      typeof publicId !== "string" ||
      !publicId.startsWith(prefix) ||
      publicId.length === prefix.length ||
      /(^|\/)\.{1,2}(\/|$)|\/\//.test(publicId) ||
      !urlMatchesPublicId(url, publicId)
    ) {
      throw invalid("images", "Image does not belong to this organization");
    }
    return { url, publicId, width, height };
  });
}

function normalizeSku(raw: unknown): string {
  const sku = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!isValidSkuKey(sku)) throw invalid("sku", "Enter a valid SKU");
  return sku;
}

function assertPrice(value: unknown, path: string): void {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > MAX_PRICE_MINOR
  ) {
    throw invalid(path, "Enter a whole number of paisa (0 or more)");
  }
}

function assertSaleNotAboveRegular(sale: unknown, regular: unknown): void {
  if (typeof sale === "number" && typeof regular === "number" && sale > regular) {
    throw invalid("salePriceMinor", "The sale price cannot be higher than the regular price");
  }
}

/** Plain (JSON-like) field set for a new product, with derived keys. Nothing here is a sentinel. */
function createFields(orgId: string, input: ProductInput): Fields {
  const src = input as unknown as Fields;
  const out: Fields = {};
  for (const key of INPUT_KEYS) {
    if (src[key] !== undefined && src[key] !== null) out[key] = src[key];
  }
  if (typeof out.name !== "string" || out.name.length === 0)
    throw invalid("name", "Enter the product name");
  out.sku = normalizeSku(out.sku);
  assertPrice(out.regularPriceMinor, "regularPriceMinor");
  if (out.salePriceMinor !== undefined) assertPrice(out.salePriceMinor, "salePriceMinor");
  if (out.wholesalePriceMinor !== undefined)
    assertPrice(out.wholesalePriceMinor, "wholesalePriceMinor");
  assertSaleNotAboveRegular(out.salePriceMinor, out.regularPriceMinor);
  if (out.categoryId !== undefined && !isValidIdSegment(out.categoryId)) {
    throw invalid("categoryId", "Choose a valid category");
  }
  out.images = normalizeImages(orgId, out.images ?? []);
  out.variants = normalizeVariants(out.variants ?? []);
  out.availability ??= "draft";
  out.specifications ??= {};
  out.faqs ??= [];
  out.archived = out.availability === "archived";
  out.nameLower = nameLowerKey(out.name);
  out.skuLower = skuLowerKey(out.sku as string);
  return out;
}

/** Changed fields for a PATCH; `null` marks a field to clear. Derived keys are recomputed. */
function patchFields(orgId: string, patch: ProductPatch): Fields {
  const src = patch as unknown as Fields;
  const out: Fields = {};
  for (const key of INPUT_KEYS) {
    const value = src[key];
    if (value === undefined) continue;
    if (value === null && !CLEARABLE.has(key)) throw invalid(key, "Invalid value");
    out[key] = value;
  }
  if (Object.keys(out).length === 0) throw invalid("body", "At least one field is required");
  if (out.name !== undefined) {
    if (typeof out.name !== "string" || out.name.length === 0)
      throw invalid("name", "Enter the product name");
    out.nameLower = nameLowerKey(out.name);
  }
  if (out.sku !== undefined) {
    out.sku = normalizeSku(out.sku);
    out.skuLower = skuLowerKey(out.sku as string);
  }
  if (out.regularPriceMinor !== undefined) assertPrice(out.regularPriceMinor, "regularPriceMinor");
  if (out.salePriceMinor != null) assertPrice(out.salePriceMinor, "salePriceMinor");
  if (out.wholesalePriceMinor != null) assertPrice(out.wholesalePriceMinor, "wholesalePriceMinor");
  if (out.categoryId != null && !isValidIdSegment(out.categoryId)) {
    throw invalid("categoryId", "Choose a valid category");
  }
  if (out.images !== undefined) out.images = normalizeImages(orgId, out.images);
  if (out.variants !== undefined) out.variants = normalizeVariants(out.variants);
  if (out.availability !== undefined) out.archived = out.availability === "archived";
  return out;
}

// ---- locks ---------------------------------------------------------------------------------

function newLockData(organizationId: string, productId: string) {
  return { organizationId, productId, createdAt: FieldValue.serverTimestamp() };
}

/** True when the lock document exists and belongs to this product in this organization. */
function ownsLock(snap: DocumentSnapshot, organizationId: string, productId: string): boolean {
  return (
    snap.exists &&
    snap.get("organizationId") === organizationId &&
    snap.get("productId") === productId
  );
}

/** The category must exist in the caller's organization (same NotFound-style answer as missing). */
function assertCategorySnapshot(snap: DocumentSnapshot, orgId: string): void {
  if (!categoryRepo.fromSnapshot(snap, orgId))
    throw invalid("categoryId", "Choose a valid category");
}

// ---- create --------------------------------------------------------------------------------

export async function createProduct(ctx: ProductCtx, input: ProductInput): Promise<Product> {
  assertCtx(ctx);
  const orgId = ctx.organizationId;
  const fields = createFields(orgId, input);
  const sku = fields.sku as string;
  const variants = fields.variants as ProductVariant[];
  const unitIds = variants.length > 0 ? variants.map((v) => v.id) : [DEFAULT_VARIANT_ID];
  const skuRef = skuLockRef(orgId, sku);
  const candidates = slugCandidates(baseSlug(fields.name as string, sku));
  const slugRefs = candidates.map((c) => slugLockRef(orgId, c));

  for (let attempt = 1; attempt <= CREATE_ATTEMPTS; attempt++) {
    // Probe (see UNIQUENESS above): picks the first free slug and reports a taken SKU early.
    const probe = await adminDb().getAll(skuRef, ...slugRefs);
    if (probe[0]!.exists) throw new ConflictError(DUPLICATE_SKU_MESSAGE);
    const free = probe.slice(1).findIndex((s) => !s.exists);
    if (free < 0) throw new ConflictError(SLUG_EXHAUSTED_MESSAGE);
    const slug = candidates[free]!;

    let id = "";
    try {
      await adminDb().runTransaction(async (tx) => {
        // Reads first: the category must belong to this organization.
        if (typeof fields.categoryId === "string") {
          assertCategorySnapshot(await tx.get(categoryRepo.docRef(fields.categoryId)), orgId);
        }
        const { ref, data } = buildProduct(orgId, { ...fields, slug });
        id = ref.id;
        tx.create(skuRef, newLockData(orgId, ref.id));
        tx.create(slugRefs[free]!, newLockData(orgId, ref.id));
        tx.create(ref, data);
        for (const variantId of unitIds) {
          tx.create(
            inventoryRef(ref.id, variantId),
            newInventoryData(orgId, ref.id, variantId, FieldValue.serverTimestamp()),
          );
        }
        writeAuditInTransaction(tx, {
          organizationId: orgId,
          actorUid: ctx.uid,
          action: "product.create",
          resource: "product",
          resourceId: ref.id,
          after: {
            changedFields: INPUT_KEYS.filter((k) => fields[k] !== undefined),
            ...auditValues(fields),
          },
        });
      });
    } catch (err) {
      // Lost a race for the SKU or the slug: probe again and report the real cause.
      if (isAlreadyExists(err)) continue;
      throw err;
    }
    return getProduct(ctx, id);
  }
  throw new ConflictError(BUSY_MESSAGE);
}

// ---- read ----------------------------------------------------------------------------------

export async function getProduct(ctx: ProductCtx, id: string): Promise<Product> {
  assertCtx(ctx);
  assertProductId(id);
  const doc = await productRepo.get(ctx.organizationId, id);
  if (!doc) throw new NotFoundError();
  return toProduct(doc);
}

export async function listProducts(ctx: ProductCtx, q: ProductListQuery): Promise<ProductPage> {
  assertCtx(ctx);
  const plan = buildListPlan(q);
  const page = await productRepo.list(ctx.organizationId, {
    where: plan.where,
    orderBy: plan.orderBy,
    limit: plan.limit,
    cursor: plan.cursor,
  });
  return { items: page.items.map(toProduct), nextCursor: page.nextCursor };
}

// ---- update --------------------------------------------------------------------------------

export async function updateProduct(
  ctx: ProductCtx,
  id: string,
  patch: ProductPatch,
): Promise<Product> {
  assertCtx(ctx);
  assertProductId(id);
  const orgId = ctx.organizationId;
  const next = patchFields(orgId, patch);

  try {
    await adminDb().runTransaction(async (tx) => {
      const ref = productRepo.docRef(id);
      const current = productRepo.fromSnapshot(await tx.get(ref), orgId);
      if (!current) throw new NotFoundError();
      const currentFields = current as unknown as Fields;

      // The merged result must keep sale <= regular (a patch may set only one of the two).
      const regular = (next.regularPriceMinor as number | undefined) ?? current.regularPriceMinor;
      const sale =
        next.salePriceMinor === null ? undefined : (next.salePriceMinor ?? current.salePriceMinor);
      assertSaleNotAboveRegular(sale, regular);

      // ---- reads (all before any write) ----
      const newSku =
        typeof next.sku === "string" && next.sku !== current.sku ? next.sku : undefined;
      const newSkuLock = newSku ? skuLockRef(orgId, newSku) : null;
      const oldSkuLock = newSku ? trySkuLockRef(orgId, current.sku) : null;

      let oldUnits: string[] = [];
      let newUnits: string[] = [];
      let nextVariants: ProductVariant[] | undefined;
      if (next.variants !== undefined) {
        nextVariants = next.variants as ProductVariant[];
        oldUnits =
          (current.variants ?? []).length > 0
            ? current.variants.map((v) => v.id)
            : [DEFAULT_VARIANT_ID];
        newUnits = nextVariants.length > 0 ? nextVariants.map((v) => v.id) : [DEFAULT_VARIANT_ID];
      }
      const removed = oldUnits.filter((u) => !newUnits.includes(u));
      const added = newUnits.filter((u) => !oldUnits.includes(u));

      const [categorySnap, newSkuSnap, oldSkuSnap, removedSnaps, reservationSnaps, addedSnaps] =
        await Promise.all([
          typeof next.categoryId === "string" && next.categoryId !== current.categoryId
            ? tx.get(categoryRepo.docRef(next.categoryId))
            : Promise.resolve(null),
          newSkuLock ? tx.get(newSkuLock) : Promise.resolve(null),
          oldSkuLock ? tx.get(oldSkuLock) : Promise.resolve(null),
          Promise.all(removed.map((u) => tx.get(inventoryRef(id, u)))),
          Promise.all(
            removed.map((u) => tx.get(inventoryRef(id, u).collection("reservations").limit(1))),
          ),
          Promise.all(added.map((u) => tx.get(inventoryRef(id, u)))),
        ]);

      // ---- checks ----
      if (categorySnap) assertCategorySnapshot(categorySnap, orgId);
      if (newSkuSnap?.exists && !ownsLock(newSkuSnap, orgId, id))
        throw new ConflictError(DUPLICATE_SKU_MESSAGE);
      removedSnaps.forEach((snap, i) => {
        const hasStock =
          snap.exists &&
          ["onHand", "reserved", "available"].some((k) => Number(snap.get(k) ?? 0) !== 0);
        if (hasStock || !reservationSnaps[i]!.empty) throw new ConflictError(VARIANT_STOCK_MESSAGE);
      });

      // ---- writes ----
      if (newSkuLock && newSkuSnap && !newSkuSnap.exists)
        tx.create(newSkuLock, newLockData(orgId, id));
      if (oldSkuLock && oldSkuSnap && ownsLock(oldSkuSnap, orgId, id)) tx.delete(oldSkuLock);

      removedSnaps.forEach((snap) => {
        if (snap.exists) tx.delete(snap.ref);
      });
      added.forEach((variantId, i) => {
        if (!addedSnaps[i]!.exists) {
          tx.create(
            inventoryRef(id, variantId),
            newInventoryData(orgId, id, variantId, FieldValue.serverTimestamp()),
          );
        }
      });

      const write: Fields = {};
      for (const [key, value] of Object.entries(next))
        write[key] = value === null ? FieldValue.delete() : value;
      write.updatedAt = FieldValue.serverTimestamp();
      tx.update(ref, write);

      // Audit: names of the fields that really changed, plus non-free-text before/after values.
      const changed = INPUT_KEYS.filter(
        (key) =>
          next[key] !== undefined &&
          stableJson(currentFields[key] ?? null) !== stableJson(next[key] ?? null),
      );
      const before: Fields = {};
      const after: Fields = {};
      for (const key of changed) {
        before[key] = currentFields[key];
        after[key] = next[key];
      }
      writeAuditInTransaction(tx, {
        organizationId: orgId,
        actorUid: ctx.uid,
        action: "product.update",
        resource: "product",
        resourceId: id,
        before: auditValues(before),
        after: { changedFields: changed, ...auditValues(after) },
      });
    });
  } catch (err) {
    // Lost a race for the new SKU between our read and the commit.
    if (isAlreadyExists(err) && typeof next.sku === "string")
      throw new ConflictError(DUPLICATE_SKU_MESSAGE);
    throw err;
  }
  return getProduct(ctx, id);
}

// ---- archive -------------------------------------------------------------------------------

/**
 * Soft delete: `archived = true`, `availability = "archived"`. Idempotent (an already archived
 * product is returned unchanged, with no write and no audit row). The SKU and slug locks and the
 * inventory documents are kept. Un-archive with a PATCH of `availability` (`active` / `draft`).
 */
export async function archiveProduct(ctx: ProductCtx, id: string): Promise<Product> {
  assertCtx(ctx);
  assertProductId(id);
  await adminDb().runTransaction(async (tx: Transaction) => {
    const ref = productRepo.docRef(id);
    const current = productRepo.fromSnapshot(await tx.get(ref), ctx.organizationId);
    if (!current) throw new NotFoundError();
    if (current.archived && current.availability === "archived") return;

    tx.update(ref, {
      archived: true,
      availability: "archived",
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAuditInTransaction(tx, {
      organizationId: ctx.organizationId,
      actorUid: ctx.uid,
      action: "product.archive",
      resource: "product",
      resourceId: id,
      before: { availability: current.availability },
      after: { availability: "archived", sku: current.sku },
    });
  });
  return getProduct(ctx, id);
}
