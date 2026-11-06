/**
 * Organization-scoped read access to `inventory` documents (list/get). Server-only.
 * Writes go through `services/inventory/stock.ts` (transactions); see products.ts for the
 * document id and shape helpers.
 */
import "server-only";

import type { InventoryRecord } from "@/schemas/inventory";

import { OrgRepository } from "./base";
import { INVENTORY } from "./products";

export const inventoryRepo = new OrgRepository<InventoryRecord>(INVENTORY, {
  filterable: ["productId", "available"],
  sortable: ["updatedAt", "variantId", "available"],
});
