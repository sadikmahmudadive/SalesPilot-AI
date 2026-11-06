/**
 * GET /api/inventory   ?productId&lowStock&limit&cursor
 *                      -> 200 { items: InventoryListItem[], nextCursor: string | null }
 *   Default order: most recently changed first. `productId` lists that product's variants
 *   (by variant id); `lowStock=true` lists units with available <= LOW_STOCK_THRESHOLD, lowest
 *   first. `productId` and `lowStock=true` cannot be combined (400).
 *
 * organizationId and uid come from the verified session and membership document, never from the
 * request. Errors: 400 validation, 401, 403.
 */
import { withApi } from "@/lib/api/handler";
import { listInventory } from "@/services/inventory/inventory-list";
import { parseListParams } from "@/services/inventory/inventory-query";

export const GET = withApi({ permission: "inventory:read" }, async ({ req, organizationId, uid }) =>
  listInventory({ organizationId, uid }, parseListParams(new URL(req.url).searchParams)),
);
