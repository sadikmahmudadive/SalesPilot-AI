/**
 * GET   /api/orders/[id]  -> 200 Order & { expired: boolean }
 * PATCH /api/orders/[id]  orderDraftPatchSchema -> 200 Order
 *   Edits a draft only (lines, shippingAddress, paymentMethod, discountMinor, notes); at least one
 *   field is required. Replacing `lines` re-reserves stock and extends the hold.
 *
 * An unknown id, an invalid id (e.g. containing "/") and another organization's id are all the
 * same 404, so ids cannot be probed. Errors: 400, 401, 403, 404, 409 (not a draft, edit in
 * progress, out of stock), 415, 429.
 */
import { withApi } from "@/lib/api/handler";
import { orderDraftPatchSchema } from "@/schemas/order";
import { updateDraftOrder } from "@/services/orders/drafts";
import { getOrder } from "@/services/orders/queries";

export const GET = withApi({ permission: "orders:read" }, async ({ params, organizationId, uid }) =>
  getOrder({ organizationId, uid }, params.id ?? ""),
);

export const PATCH = withApi(
  {
    permission: "orders:write",
    schema: orderDraftPatchSchema,
    rateLimit: { name: "orders.update", limit: 60, windowSec: 60 },
  },
  async ({ params, body, organizationId, uid }) =>
    updateDraftOrder({ organizationId, uid }, params.id ?? "", body),
);
