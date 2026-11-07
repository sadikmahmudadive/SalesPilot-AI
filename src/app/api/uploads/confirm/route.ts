/**
 * POST /api/uploads/confirm   { kind, publicId } -> { url, publicId, width, height }
 *   Verifies a finished upload through the Cloudinary Admin API, records the confirmation and
 *   returns the shape products store. An asset over the size limit or in a disallowed format is
 *   deleted and rejected. `publicId` must be one this server generated for this organization's
 *   `kind` folder. Products accept only images that were confirmed here.
 *
 * Limits: 60/min per user (withApi), plus 120/hour per user and 300/hour per organization
 * (quota.ts), because every confirm spends one account-wide Cloudinary Admin API call.
 *
 * Errors: 400 (rejected asset), 401, 403 (foreign id, kind mismatch or role), 404 (no such asset),
 * 415, 429, 500 (Cloudinary failure or deployment mismatch, generic), 503 (not configured).
 */
import { withApi } from "@/lib/api/handler";
import { assertCloudinaryConfigured, confirmUpload } from "@/lib/cloudinary";
import { assertOwnedPublicIdOfKind, kindPermission, uploadPolicy } from "@/lib/cloudinary/folders";
import { assertConfirmQuota } from "@/lib/cloudinary/quota";
import { ForbiddenError } from "@/lib/errors";
import { can } from "@/lib/security/permissions";
import { confirmUploadSchema } from "@/schemas/upload";

export const POST = withApi(
  {
    permission: "any-member",
    schema: confirmUploadSchema,
    rateLimit: { name: "uploads.confirm", limit: 60, windowSec: 60 },
  },
  async ({ body, organizationId, role, uid }) => {
    assertCloudinaryConfigured();
    if (!can(role, kindPermission(body.kind))) throw new ForbiddenError();
    // Cheap checks first, so forged ids and unavailable kinds never spend quota.
    assertOwnedPublicIdOfKind(organizationId, body.kind, body.publicId);
    uploadPolicy(body.kind);
    await assertConfirmQuota(uid, organizationId);
    return confirmUpload(organizationId, body.kind, body.publicId);
  },
);
