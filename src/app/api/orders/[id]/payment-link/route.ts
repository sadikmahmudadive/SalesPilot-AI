import { withApi } from "@/lib/api/handler";
import { createPaymentLink } from "@/services/payments/links";

export const POST = withApi(
  {
    permission: "orders:write",
    rateLimit: { name: "orders.payment_link", limit: 20, windowSec: 60 },
  },
  async ({ params, organizationId, req }) => {
    const origin = req.headers.get("origin") ?? "http://localhost:3000";
    return createPaymentLink(organizationId, params.id ?? "", origin);
  },
);
