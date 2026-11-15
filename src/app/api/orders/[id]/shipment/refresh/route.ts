import { withApi } from "@/lib/api/handler";
import { refreshShipmentStatus } from "@/services/couriers/booking";

export const POST = withApi(
  {
    permission: "orders:write",
    rateLimit: { name: "orders.shipment.refresh", limit: 30, windowSec: 60 },
  },
  async ({ params, organizationId, uid }) =>
    refreshShipmentStatus({ organizationId, uid }, params.id ?? ""),
);
