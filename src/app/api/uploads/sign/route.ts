/**
 * POST /api/uploads/sign   { kind, contentType, bytes } -> SignedUpload
 *   Signs ONE direct-to-Cloudinary upload to a server-generated public id
 *   `organizations/{orgId}/{kind}/{24 hex}` (returned as `publicId`). The id, overwrite
 *   flag and public-id behaviour are signed server-side; any `folder` / `public_id` in the body is
 *   stripped. `kind` needs `uploads:products` (products), `uploads:customers` (customers) or
 *   `uploads:org` (campaigns); knowledge is not available yet.
 *
 * Errors: 400 (type, size, kind), 401, 403, 415, 429 (30/min), 503 (Cloudinary not configured).
 */
import { withApi } from "@/lib/api/handler";
import { assertCloudinaryConfigured, signUpload } from "@/lib/cloudinary";
import { kindPermission } from "@/lib/cloudinary/folders";
import { ForbiddenError } from "@/lib/errors";
import { can } from "@/lib/security/permissions";
import { signUploadSchema } from "@/schemas/upload";

export const POST = withApi(
  {
    permission: "any-member",
    schema: signUploadSchema,
    rateLimit: { name: "uploads.sign", limit: 30, windowSec: 60 },
  },
  async ({ body, organizationId, role }) => {
    assertCloudinaryConfigured();
    if (!can(role, kindPermission(body.kind))) throw new ForbiddenError();
    return signUpload(organizationId, body.kind, {
      contentType: body.contentType,
      bytes: body.bytes,
    });
  },
);
