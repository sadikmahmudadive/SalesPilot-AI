/**
 * Product and inventory-stub data access (categories: see categories.ts). Server-only.
 *
 *   products/{productId}                          the product (see ProductDoc)
 *   productSkus/{organizationId}_{sku}            SKU uniqueness lock   { organizationId, productId, createdAt }
 *   productSlugs/{organizationId}_{slug}          slug uniqueness lock  { organizationId, productId, createdAt }
 *   inventory/{productId}__{variantId}            stock counters (created with the product; Task 18+ owns them)
 *
 * Lock documents are written in the SAME transaction as the document they protect, so SKUs
 * and slugs are unique per organization without a query. Every one of these
 * collections is denied to clients by the Firestore rules (locks fall through to default deny;
 * products, categories and inventory are read-only for members).
 *
 * Lock ids join the organization id and a key with "_". Organization ids are server-generated
 * (Firestore auto ids / uuids), and SKUs / slugs / hashes cannot contain "/", so two different
 * (org, key) pairs cannot produce one lock id in practice.
 */
import "server-only";

import type { DocumentReference } from "firebase-admin/firestore";

import { ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { isValidIdSegment } from "@/lib/ids";
import type { Product } from "@/schemas/product";

import { OrgRepository, type OrgCreateInput } from "./base";

/** Stored product: the public shape plus service-computed keys (case-insensitive name / SKU). */
export type ProductDoc = Product & { nameLower: string; skuLower: string };

export const PRODUCTS = "products";
export const PRODUCT_SKUS = "productSkus";
export const PRODUCT_SLUGS = "productSlugs";
export const INVENTORY = "inventory";

export const productRepo = new OrgRepository<ProductDoc>(PRODUCTS, {
  filterable: ["archived", "availability", "categoryId", "nameLower", "skuLower"],
  sortable: ["createdAt", "updatedAt", "nameLower", "skuLower"],
});

/** `build` for payloads that hold Firestore sentinels (typed loosely on purpose). */
export function buildProduct(orgId: string, data: Record<string, unknown>) {
  return productRepo.build(orgId, data as unknown as OrgCreateInput<ProductDoc>);
}

const SKU_KEY = /^[A-Z0-9._-]{1,64}$/;

/** Reference to the lock document `{collection}/{orgId}_{key}`. */
export function orgLockRef(
  collection: string,
  orgId: string,
  key: string,
  path: string,
): DocumentReference {
  const id = `${orgId}_${key}`;
  if (!isValidIdSegment(orgId) || !isValidIdSegment(id)) {
    throw new ValidationError([{ path, message: "Invalid value" }]);
  }
  return adminDb().collection(collection).doc(id);
}

/** True for a well-formed (already upper-cased) SKU. */
export function isValidSkuKey(sku: unknown): sku is string {
  return typeof sku === "string" && SKU_KEY.test(sku);
}

/** Lock of (organization, upper-cased SKU). */
export function skuLockRef(orgId: string, sku: string): DocumentReference {
  if (!isValidSkuKey(sku)) {
    throw new ValidationError([{ path: "sku", message: "Invalid SKU" }]);
  }
  return orgLockRef(PRODUCT_SKUS, orgId, sku, "sku");
}

/** Like `skuLockRef`, but null when the stored SKU is missing or malformed (corrupt row). */
export function trySkuLockRef(orgId: string, sku: unknown): DocumentReference | null {
  if (!isValidSkuKey(sku)) return null;
  return skuLockRef(orgId, sku);
}

export function slugLockRef(orgId: string, slug: string): DocumentReference {
  if (typeof slug !== "string" || slug.length === 0 || slug.length > 200 || /[/.]/.test(slug)) {
    throw new ValidationError([{ path: "slug", message: "Invalid slug" }]);
  }
  return orgLockRef(PRODUCT_SLUGS, orgId, slug, "slug");
}

/** Like `slugLockRef`, but null when the stored slug is missing or malformed (corrupt row). */
export function trySlugLockRef(orgId: string, slug: unknown): DocumentReference | null {
  if (typeof slug !== "string" || slug.length === 0 || slug.length > 200 || /[/.]/.test(slug))
    return null;
  return slugLockRef(orgId, slug);
}

/** Inventory document of one stock-keeping unit of a product. */
export function inventoryRef(productId: string, variantId: string): DocumentReference {
  if (!isValidIdSegment(productId) || !/^(default|[a-z0-9-]{1,40})$/.test(variantId)) {
    throw new ValidationError([{ path: "variantId", message: "Invalid variant" }]);
  }
  return adminDb().collection(INVENTORY).doc(`${productId}__${variantId}`);
}

/** Initial inventory document: no stock, nothing reserved. Timestamps are server time. */
export function newInventoryData(
  organizationId: string,
  productId: string,
  variantId: string,
  serverTimestamp: unknown,
) {
  return {
    organizationId,
    productId,
    variantId,
    onHand: 0,
    reserved: 0,
    available: 0,
    createdAt: serverTimestamp,
    updatedAt: serverTimestamp,
  };
}
