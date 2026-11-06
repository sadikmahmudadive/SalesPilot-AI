/**
 * Inventory list: an organization-scoped page of inventory rows enriched with product data.
 * Server-only. Query rules live in inventory-query.ts, indexes in inventory-indexes.ts.
 *
 * ENRICHMENT. The page's distinct product documents are read ONCE with `getAll`. A product that
 * is missing, malformed or belongs to another organization is replaced by a placeholder
 * ("Unknown product", no SKU): nothing of a foreign product (name, SKU, variants) is ever copied.
 */
import "server-only";

import type { DocumentSnapshot } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { isValidIdSegment } from "@/lib/ids";
import { assertOrgCtx, type OrgCtx } from "@/lib/org-context";
import { inventoryRepo } from "@/repositories/inventory";
import { PRODUCTS } from "@/repositories/products";
import type { InventoryListItem, InventoryRecord } from "@/schemas/inventory";

import { buildListPlan, variantLabelOf, type InventoryListQuery } from "./inventory-query";

export const UNKNOWN_PRODUCT_NAME = "Unknown product";

interface ProductInfo {
  name: string;
  sku: string | null;
  variants: ReadonlyArray<{ id?: unknown; size?: unknown; color?: unknown }>;
}

function productInfo(snap: DocumentSnapshot, orgId: string): ProductInfo | null {
  const data = snap.exists ? snap.data() : undefined;
  if (!data || data.organizationId !== orgId || typeof data.name !== "string") return null;
  return {
    name: data.name,
    sku: typeof data.sku === "string" ? data.sku : null,
    variants: Array.isArray(data.variants) ? (data.variants as ProductInfo["variants"]) : [],
  };
}

export async function listInventory(
  ctx: OrgCtx,
  q: InventoryListQuery,
): Promise<{ items: InventoryListItem[]; nextCursor: string | null }> {
  assertOrgCtx(ctx, "Inventory");
  const plan = buildListPlan(q);
  const page = await inventoryRepo.list(ctx.organizationId, {
    where: plan.where,
    orderBy: plan.orderBy,
    limit: plan.limit,
    cursor: plan.cursor,
  });

  const productIds = [
    ...new Set(page.items.map((i) => i.productId).filter((id) => isValidIdSegment(id))),
  ];
  const products = new Map<string, ProductInfo | null>();
  if (productIds.length > 0) {
    const db = adminDb();
    const snaps = await db.getAll(...productIds.map((id) => db.collection(PRODUCTS).doc(id)));
    snaps.forEach((snap, i) => products.set(productIds[i]!, productInfo(snap, ctx.organizationId)));
  }

  const items = page.items.map((row: InventoryRecord): InventoryListItem => {
    const product = products.get(row.productId) ?? null;
    return {
      ...row,
      productName: product?.name ?? UNKNOWN_PRODUCT_NAME,
      sku: product?.sku ?? null,
      variantLabel: variantLabelOf(row.variantId, product?.variants),
    };
  });
  return { items, nextCursor: page.nextCursor };
}
