/** GET /api/me -> { uid, email, organizationId, role } for the signed-in organization member. */
import { withApi } from "@/lib/api/handler";

export const GET = withApi({ permission: "any-member" }, async ({ uid, email, organizationId, role }) => ({
  uid,
  email,
  organizationId,
  role,
}));
