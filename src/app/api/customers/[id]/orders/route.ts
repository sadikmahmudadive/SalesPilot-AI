/**
 * GET /api/customers/[id]/orders  -> 200 { items: Order[] }   (the customer's 5 newest orders)
 *
 * Feeds the inbox customer sidebar. The customer is looked up in the caller's organization first,
 * so an unknown id, an invalid id and another organization's customer are the same 404 as
 * GET /api/customers/[id], and orders are never listed for a customer that is not yours.
 */
import { withApi } from "@/lib/api/handler";
import { getCustomer } from "@/services/crm/customers";
import { listCustomerOrders } from "@/services/orders/queries";

export const GET = withApi(
  { permission: "orders:read" },
  async ({ params, organizationId, uid }) => {
    const ctx = { organizationId, uid };
    const customerId = params.id ?? "";
    await getCustomer(ctx, customerId);
    return { items: await listCustomerOrders(ctx, customerId, 5) };
  },
);
