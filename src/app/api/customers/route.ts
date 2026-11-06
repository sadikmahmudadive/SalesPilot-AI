/**
 * GET  /api/customers   ?q&segment&customerType&tag&assignedAgentId&sort&dir&limit&cursor
 *                       -> 200 { items: Customer[], nextCursor: string | null }
 * POST /api/customers   customerInputSchema -> 201 Customer
 *
 * organizationId and uid come from the verified session and membership document, never from the
 * request. Errors: 400 validation, 401, 403, 409 duplicate phone, 415, 429.
 */
import { withApi } from "@/lib/api/handler";
import { customerInputSchema } from "@/schemas/customer";
import { parseListParams } from "@/services/crm/customer-query";
import { createCustomer, listCustomers } from "@/services/crm/customers";

export const GET = withApi({ permission: "customers:read" }, async ({ req, organizationId, uid }) =>
  listCustomers({ organizationId, uid }, parseListParams(new URL(req.url).searchParams)),
);

export const POST = withApi(
  {
    permission: "customers:write",
    schema: customerInputSchema,
    rateLimit: { name: "customers.create", limit: 60, windowSec: 60 },
  },
  async ({ body, organizationId, uid }) =>
    Response.json(await createCustomer({ organizationId, uid }, body), { status: 201 }),
);
