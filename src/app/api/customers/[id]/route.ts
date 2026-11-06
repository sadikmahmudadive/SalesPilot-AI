/**
 * GET    /api/customers/[id]  -> 200 Customer
 * PATCH  /api/customers/[id]  customerPatchSchema -> 200 Customer (null clears email / whatsappNumber / address / leadSource)
 *   Patched fields replace the stored value; a patched `preferences` or `consent` replaces the WHOLE map (no merge).
 * DELETE /api/customers/[id]  -> 204 (no body)
 *
 * An unknown id, an invalid id (e.g. containing "/") and another organization's id are all the
 * same 404, so ids cannot be probed.
 */
import { withApi } from "@/lib/api/handler";
import { customerPatchSchema } from "@/schemas/customer";
import { deleteCustomer, getCustomer, updateCustomer } from "@/services/crm/customers";

export const GET = withApi(
  { permission: "customers:read" },
  async ({ params, organizationId, uid }) => getCustomer({ organizationId, uid }, params.id ?? ""),
);

export const PATCH = withApi(
  {
    permission: "customers:write",
    schema: customerPatchSchema,
    rateLimit: { name: "customers.update", limit: 60, windowSec: 60 },
  },
  async ({ params, body, organizationId, uid }) =>
    updateCustomer({ organizationId, uid }, params.id ?? "", body),
);

export const DELETE = withApi(
  {
    permission: "customers:write",
    rateLimit: { name: "customers.delete", limit: 60, windowSec: 60 },
  },
  async ({ params, organizationId, uid }) => {
    await deleteCustomer({ organizationId, uid }, params.id ?? "");
    return new Response(null, { status: 204 });
  },
);
