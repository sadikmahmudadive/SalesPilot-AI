/**
 * POST /api/inventory/adjust   { productId, variantId, delta, reason } -> 200 InventoryRecord
 *   Changes `onHand` by `delta` (nonzero whole number, |delta| <= 1,000,000); `reason` is 3-200
 *   characters. Audited. Reserve / release / commit have NO route in this phase (server-only).
 *
 * An unknown, malformed or another organization's product / variant is a 404. Errors: 400
 * validation, 401, 403, 404, 409 (would drop onHand below the reserved quantity, or inventory
 * busy: retry), 415, 429.
 */
import { withApi } from "@/lib/api/handler";
import { adjustInputSchema } from "@/schemas/inventory";
import { adjustStock } from "@/services/inventory/stock";

export const POST = withApi(
  {
    permission: "inventory:write",
    schema: adjustInputSchema,
    rateLimit: { name: "inventory.adjust", limit: 60, windowSec: 60 },
  },
  async ({ body, organizationId, uid }) =>
    adjustStock({ organizationId, uid }, body.productId, body.variantId, {
      delta: body.delta,
      reason: body.reason,
    }),
);
