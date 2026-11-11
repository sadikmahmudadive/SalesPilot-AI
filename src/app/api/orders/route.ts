/**
 * GET  /api/orders   ?status&paymentStatus&customerId&q&from&to&limit&cursor
 *                    -> 200 { items: Order[], nextCursor: string | null }
 *   `q` is an order number (SP-000123) or a phone number; `from` / `to` are ISO datetimes with an
 *   offset. One equality filter at a time (400 otherwise). Empty values count as absent.
 * POST /api/orders   orderCreateSchema -> 201 Order (source "staff", createdBy the signed-in user)
 *   `confirm: true` creates the draft, then confirms it if it is still a draft. A replay with the
 *   same `idempotencyKey` returns the existing order unchanged (never a 409).
 *
 * organizationId and uid come from the verified session and membership document, never from the
 * request. Errors: 400 validation, 401, 403, 404 (customer / product), 409, 415, 429.
 */
import { withApi } from "@/lib/api/handler";
import { parseQueryParams } from "@/lib/list-params";
import { orderCreateSchema, orderListQuerySchema } from "@/schemas/order";
import { createDraftOrder } from "@/services/orders/drafts";
import { confirmOrder } from "@/services/orders/lifecycle";
import { listOrders } from "@/services/orders/queries";

export const GET = withApi(
  {
    permission: "orders:read",
    rateLimit: { name: "orders.list", limit: 120, windowSec: 60 },
  },
  async ({ req, organizationId, uid }) => {
    // An empty value (`?status=`) means "no filter", as on the customers list.
    const params = new URLSearchParams();
    for (const [key, value] of new URL(req.url).searchParams) {
      if (value !== "" || params.has(key)) params.append(key, value);
    }
    return listOrders({ organizationId, uid }, parseQueryParams(params, orderListQuerySchema));
  },
);

export const POST = withApi(
  {
    permission: "orders:write",
    schema: orderCreateSchema,
    rateLimit: { name: "orders.create", limit: 30, windowSec: 60 },
  },
  async ({ body, organizationId, uid }) => {
    const ctx = { organizationId, uid };
    const { confirm, ...input } = body;
    const draft = await createDraftOrder(ctx, { ...input, source: "staff" });
    // A replay returns the stored order as-is; only a still-draft order is confirmed.
    const order = confirm && draft.status === "draft" ? await confirmOrder(ctx, draft.id) : draft;
    return Response.json(order, { status: 201 });
  },
);
