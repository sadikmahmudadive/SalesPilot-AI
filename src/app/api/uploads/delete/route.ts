/**
 * POST /api/uploads/delete   { publicId } -> { ok: true }
 *   Deletes an asset under this organization's folders. Idempotent (already gone is success). The
 *   kind comes from the validated public id and needs the matching upload permission. It does not
 *   check whether a product still references the image: remove it from the product first.
 *
 * Errors: 401, 403 (foreign id or role), 415, 429 (60/min), 500 (Cloudinary failure), 503.
 */
import { withApi } from "@/lib/api/handler";
import { assertCloudinaryConfigured, deleteAsset } from "@/lib/cloudinary";
import { assertOwnedPublicId, kindPermission } from "@/lib/cloudinary/folders";
import { ForbiddenError } from "@/lib/errors";
import { can } from "@/lib/security/permissions";
import { deleteUploadSchema } from "@/schemas/upload";

export const POST = withApi(
  {
    permission: "any-member",
    schema: deleteUploadSchema,
    rateLimit: { name: "uploads.delete", limit: 60, windowSec: 60 },
  },
  async ({ body, organizationId, role }) => {
    assertCloudinaryConfigured();
    const kind = assertOwnedPublicId(organizationId, body.publicId);
    if (!can(role, kindPermission(kind))) throw new ForbiddenError();
    await deleteAsset(organizationId, body.publicId);
    return { ok: true };
  },
);
