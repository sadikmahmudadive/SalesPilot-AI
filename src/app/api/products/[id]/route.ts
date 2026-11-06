/**
 * GET    /api/products/[id]  -> 200 Product (archived products included)
 * PATCH  /api/products/[id]  productPatchSchema -> 200 Product
 *   null clears salePriceMinor / wholesalePriceMinor / categoryId / description. `variants`
 *   REPLACES the list (echo the ids of the variants to keep). A sale price above the regular
 *   price (after merging with the stored product) is a 400. Setting availability to active or
 *   draft un-archives; "archived" archives.
 * DELETE /api/products/[id]  -> 200 Product (archived: soft delete, idempotent)
 *   There is no hard delete: orders reference products.
 *
 * An unknown id, an invalid id (e.g. containing "/") and another organization's id are all the
 * same 404, so ids cannot be probed. Errors: 400, 401, 403, 404, 409 (duplicate SKU, variant
 * with stock), 415, 429.
 */
import { withApi } from "@/lib/api/handler";
import { productPatchSchema } from "@/schemas/product";
import { archiveProduct, getProduct, updateProduct } from "@/services/products/products";

export const GET = withApi(
  { permission: "products:read" },
  async ({ params, organizationId, uid }) => getProduct({ organizationId, uid }, params.id ?? ""),
);

export const PATCH = withApi(
  {
    permission: "products:write",
    schema: productPatchSchema,
    rateLimit: { name: "products.update", limit: 60, windowSec: 60 },
  },
  async ({ params, body, organizationId, uid }) =>
    updateProduct({ organizationId, uid }, params.id ?? "", body),
);

export const DELETE = withApi(
  {
    permission: "products:write",
    rateLimit: { name: "products.archive", limit: 60, windowSec: 60 },
  },
  async ({ params, organizationId, uid }) =>
    archiveProduct({ organizationId, uid }, params.id ?? ""),
);
