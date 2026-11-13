import { withApi } from "@/lib/api/handler";
import { bookShipmentInputSchema } from "@/schemas/courier";
import { bookShipment } from "@/services/couriers/booking";

export const POST = withApi(
  {
    permission: "orders:write",
    schema: bookShipmentInputSchema,
    rateLimit: { name: "orders.shipment.book", limit: 30, windowSec: 60 },
  },
  async ({ params, body, organizationId, uid }) =>
    bookShipment({ organizationId, uid }, params.id ?? "", body),
);
