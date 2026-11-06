/**
 * GET  /api/categories  -> 200 { items: Category[] }  (at most 200, sorted by name, no pagination)
 * POST /api/categories  categoryInputSchema -> 201 Category
 *
 * No PATCH / DELETE this phase. Errors: 400, 401, 403, 409 duplicate name (case and spacing
 * insensitive), 415, 429.
 */
import { withApi } from "@/lib/api/handler";
import { categoryInputSchema } from "@/schemas/product";
import { createCategory, listCategories } from "@/services/products/categories";

export const GET = withApi({ permission: "products:read" }, async ({ organizationId, uid }) => ({
  items: await listCategories({ organizationId, uid }),
}));

export const POST = withApi(
  {
    permission: "products:write",
    schema: categoryInputSchema,
    rateLimit: { name: "categories.create", limit: 30, windowSec: 60 },
  },
  async ({ body, organizationId, uid }) =>
    Response.json(await createCategory({ organizationId, uid }, body), { status: 201 }),
);
