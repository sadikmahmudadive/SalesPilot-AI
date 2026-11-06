/**
 * Pure helpers that turn an inventory list request into a repository query. No I/O and no
 * server-only imports, so every rule here is unit tested without Firestore.
 *
 * Three query shapes (each served by one entry of inventory-indexes.ts):
 *   default   no filter                 ORDER BY updatedAt DESC, __name__ DESC
 *   byProduct productId == X            ORDER BY variantId ASC,  __name__ ASC
 *   lowStock  available <= THRESHOLD    ORDER BY available ASC,  __name__ ASC
 * `productId` and `lowStock=true` cannot be combined (each combination would need its own
 * index). `lowStock=false` is the same as absent. Limit defaults to 25, maximum 50.
 *
 * Source hygiene: no literal non-ASCII characters in this file.
 */
import { z } from "zod";

import { LOW_STOCK_THRESHOLD } from "@/config/inventory";
import { isValidIdSegment } from "@/lib/ids";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  cursorParam,
  limitParam,
  optionalParam,
  parseQueryParams,
  staticInvalid as invalid,
} from "@/lib/list-params";
import type { WhereClause } from "@/repositories/base";

export { DEFAULT_LIMIT, MAX_LIMIT };

export interface InventoryListQuery {
  productId?: string;
  lowStock?: boolean;
  limit?: number;
  cursor?: string;
}

export type InventoryQueryShape = "default" | "byProduct" | "lowStock";
export type InventoryOrderField = "updatedAt" | "variantId" | "available";

export interface ListPlan {
  where: WhereClause[];
  orderBy: [field: InventoryOrderField, dir: "asc" | "desc"];
  limit: number;
  cursor?: string;
  shape: InventoryQueryShape;
}

/** Validates a list request and produces the repository query plus its index shape. */
export function buildListPlan(q: InventoryListQuery): ListPlan {
  const limit = q.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw invalid("limit", `Limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  if (q.lowStock !== undefined && typeof q.lowStock !== "boolean") {
    throw invalid("lowStock", "Invalid value");
  }
  if (q.productId !== undefined && !isValidIdSegment(q.productId)) {
    throw invalid("productId", "Invalid product");
  }
  if (q.productId !== undefined && q.lowStock === true) {
    throw invalid("lowStock", "Low stock cannot be combined with a product filter");
  }

  if (q.productId !== undefined) {
    return {
      where: [["productId", "==", q.productId]],
      orderBy: ["variantId", "asc"],
      limit,
      cursor: q.cursor,
      shape: "byProduct",
    };
  }
  if (q.lowStock === true) {
    return {
      where: [["available", "<=", LOW_STOCK_THRESHOLD]],
      orderBy: ["available", "asc"],
      limit,
      cursor: q.cursor,
      shape: "lowStock",
    };
  }
  return { where: [], orderBy: ["updatedAt", "desc"], limit, cursor: q.cursor, shape: "default" };
}

const listParamsSchema = z.object({
  productId: optionalParam(z.string().refine((v) => isValidIdSegment(v))),
  lowStock: optionalParam(z.enum(["true", "false"])),
  limit: limitParam(MAX_LIMIT),
  cursor: cursorParam(),
});

/**
 * Parses `?productId&lowStock&limit&cursor`. Unknown params are ignored; repeated params and
 * invalid values are a ValidationError carrying only param names and static messages.
 */
export function parseListParams(params: URLSearchParams): InventoryListQuery {
  const p = parseQueryParams(params, listParamsSchema);
  const out: InventoryListQuery = {};
  if (p.productId !== undefined) out.productId = p.productId;
  if (p.lowStock !== undefined) out.lowStock = p.lowStock === "true";
  if (p.limit !== undefined) out.limit = p.limit;
  if (p.cursor !== undefined) out.cursor = p.cursor;
  return out;
}

/** Display label of a variant: "size / color" (whichever exist), "Default" for the default unit. */
export function variantLabelOf(
  variantId: string,
  variants: ReadonlyArray<{ id?: unknown; size?: unknown; color?: unknown }> | undefined,
): string {
  const v = variants?.find((x) => x.id === variantId);
  const parts = [v?.size, v?.color].filter(
    (x): x is string => typeof x === "string" && x.trim() !== "",
  );
  return parts.length > 0 ? parts.join(" / ") : "Default";
}
