/**
 * GET  /api/products   ?q&sku&availability&categoryId&archived&sort&dir&limit&cursor
 *                      -> 200 { items: Product[], nextCursor: string | null }
 *                      Archived products are hidden unless archived=true.
 * POST /api/products   productInputSchema -> 201 Product
 *
 * organizationId and uid come from the verified session and membership document, never from the
 * request. Errors: 400 validation (incl. foreign category / image), 401, 403, 409 duplicate SKU,
 * 415, 429.
 */
import { withApi } from "@/lib/api/handler";
import { productInputSchema } from "@/schemas/product";
import { parseListParams } from "@/services/products/product-query";
import { createProduct, listProducts } from "@/services/products/products";

export const GET = withApi({ permission: "products:read" }, async ({ req, organizationId, uid }) =>
  listProducts({ organizationId, uid }, parseListParams(new URL(req.url).searchParams)),
);

export const POST = withApi(
  {
    permission: "products:write",
    schema: productInputSchema,
    rateLimit: { name: "products.create", limit: 60, windowSec: 60 },
  },
  async ({ body, organizationId, uid }) =>
    Response.json(await createProduct({ organizationId, uid }, body), { status: 201 }),
);
