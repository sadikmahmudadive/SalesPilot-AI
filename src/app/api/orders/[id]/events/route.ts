/**
 * GET /api/orders/[id]/events  -> 200 { items: OrderEvent[] }   (oldest first, at most 200)
 *
 * An unknown, invalid or another organization's id is a 404.
 */
import { withApi } from "@/lib/api/handler";
import { listOrderEvents } from "@/services/orders/queries";

export const GET = withApi(
  { permission: "orders:read" },
  async ({ params, organizationId, uid }) => ({
    items: await listOrderEvents({ organizationId, uid }, params.id ?? ""),
  }),
);
