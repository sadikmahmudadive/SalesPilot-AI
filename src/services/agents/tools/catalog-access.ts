/**
 * Shared catalog access rules for the read-only agent tools. Server-only.
 *
 * SCOPE. A product is in an agent's scope when `productAccess.mode === "all"` or its category is
 * listed. A product that is out of scope, not `active`, in another organization or simply missing
 * is the same `null` to the tools (so they answer `not_found` for all of them and nothing about
 * the product leaks).
 *
 * TENANCY. Every read here goes through `getProduct` / `inventoryRepo.fromSnapshot(snap, orgId)`,
 * which compare the stored `organizationId` with `ctx.organizationId`.
 */
import "server-only";

import { LOW_STOCK_THRESHOLD } from "@/config/inventory";
import { NotFoundError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { DEFAULT_VARIANT_ID, type Product } from "@/schemas/product";
import type { Agent } from "@/schemas/agent";
import { inventoryRepo } from "@/repositories/inventory";
import { inventoryRef } from "@/repositories/products";
import { getProduct } from "@/services/products/products";

import type { ToolContext } from "./types";

export type StockStatus = "in_stock" | "low" | "out_of_stock";

export function isProductInScope(
  agent: Pick<Agent, "productAccess">,
  product: Pick<Product, "categoryId">,
): boolean {
  const access = agent.productAccess;
  if (access.mode === "all") return true;
  return product.categoryId !== undefined && access.categoryIds.includes(product.categoryId);
}

/** The product when it exists in the organization, else null (never throws for NotFound). */
export async function loadProduct(ctx: ToolContext, productId: string): Promise<Product | null> {
  try {
    return await getProduct({ organizationId: ctx.organizationId, uid: ctx.actorUid }, productId);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

/** The product when it is active AND in the agent's scope, else null. */
export async function loadVisibleProduct(
  ctx: ToolContext,
  productId: string,
): Promise<Product | null> {
  const product = await loadProduct(ctx, productId);
  if (!product || product.availability !== "active" || !isProductInScope(ctx.agent, product)) {
    return null;
  }
  return product;
}

/** Inventory unit ids of a product: its variant ids, or `default` when it has none. */
export function stockUnitIds(product: Pick<Product, "variants">): string[] {
  return product.variants.length > 0 ? product.variants.map((v) => v.id) : [DEFAULT_VARIANT_ID];
}

/**
 * Resolves the optional `variantId` an agent passed. `undefined` means "no unit chosen";
 * `invalid` means the id is not one of the product's units.
 */
export function resolveUnit(
  product: Pick<Product, "variants">,
  variantId: string | undefined,
): { kind: "none" } | { kind: "unit"; variantId: string } | { kind: "invalid" } {
  if (variantId === undefined) return { kind: "none" };
  return stockUnitIds(product).includes(variantId)
    ? { kind: "unit", variantId }
    : { kind: "invalid" };
}

export interface StockUnit {
  productId: string;
  variantId: string;
}

export const unitKey = (u: StockUnit): string => `${u.productId}__${u.variantId}`;

/**
 * Available quantity of each unit (0 when the inventory document is missing or belongs to
 * another organization). One batched read.
 */
export async function readAvailable(
  ctx: ToolContext,
  units: readonly StockUnit[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const unique = new Map<string, StockUnit>();
  for (const u of units) unique.set(unitKey(u), u);
  if (unique.size === 0) return out;
  const list = [...unique.values()];
  const snaps = await adminDb().getAll(...list.map((u) => inventoryRef(u.productId, u.variantId)));
  snaps.forEach((snap, i) => {
    const record = inventoryRepo.fromSnapshot(snap, ctx.organizationId);
    const available = record?.available;
    out.set(
      unitKey(list[i]!),
      typeof available === "number" && Number.isFinite(available) ? Math.max(0, available) : 0,
    );
  });
  return out;
}

/** `available <= LOW_STOCK_THRESHOLD` is low (so 5 is low, 6 is not); 0 is out of stock. */
export function stockStatusOf(available: number): StockStatus {
  if (available <= 0) return "out_of_stock";
  return available <= LOW_STOCK_THRESHOLD ? "low" : "in_stock";
}

/** Retail unit price: the sale price when there is one, else the regular price. */
export function retailMinor(
  product: Pick<Product, "regularPriceMinor" | "salePriceMinor">,
): number {
  return product.salePriceMinor ?? product.regularPriceMinor;
}

/**
 * Unit price for a customer type. Wholesale uses the wholesale price; without one it falls back
 * to the retail price and says so (`wholesaleFallback`).
 */
export function unitPriceFor(
  product: Pick<Product, "regularPriceMinor" | "salePriceMinor" | "wholesalePriceMinor">,
  customerType: "retail" | "wholesale",
): { unitMinor: number; wholesaleFallback: boolean } {
  if (customerType === "wholesale") {
    if (product.wholesalePriceMinor !== undefined) {
      return { unitMinor: product.wholesalePriceMinor, wholesaleFallback: false };
    }
    return { unitMinor: retailMinor(product), wholesaleFallback: true };
  }
  return { unitMinor: retailMinor(product), wholesaleFallback: false };
}
