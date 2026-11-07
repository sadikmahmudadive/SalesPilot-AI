/**
 * POST /api/uploads/confirm   { kind, publicId } -> { url, publicId, width, height }
 *   Verifies a finished upload through the Cloudinary Admin API and returns the shape products
 *   store. An asset over the size limit or in a disallowed format is deleted and rejected.
 *   `publicId` must live under this organization's `kind` folder.
 *
 * Errors: 400 (rejected asset), 401, 403 (foreign id, kind mismatch or role), 404 (no such asset),
 * 415, 429 (60/min), 500 (Cloudinary failure, generic), 503 (not configured).
 */
import { withApi } from "@/lib/api/handler";
import { assertCloudinaryConfigured, confirmUpload } from "@/lib/cloudinary";
import { kindPermission } from "@/lib/cloudinary/folders";
import { ForbiddenError } from "@/lib/errors";
import { can } from "@/lib/security/permissions";
import { confirmUploadSchema } from "@/schemas/upload";

export const POST = withApi(
  {
    permission: "any-member",
    schema: confirmUploadSchema,
    rateLimit: { name: "uploads.confirm", limit: 60, windowSec: 60 },
  },
  async ({ body, organizationId, role }) => {
    assertCloudinaryConfigured();
    if (!can(role, kindPermission(body.kind))) throw new ForbiddenError();
    return confirmUpload(organizationId, body.kind, body.publicId);
  },
);
