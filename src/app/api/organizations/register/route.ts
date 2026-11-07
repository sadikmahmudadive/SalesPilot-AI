/**
 * POST /api/organizations/register  { organizationName, displayName }
 * -> 201 { organizationId, created: true }   a new organization was created
 * -> 200 { organizationId, created: false }  the caller already had one (idempotent per uid)
 *
 * Auth-only (the caller has no membership yet), rate limited to 5/min per user. uid and email
 * come from the verified session, never from the body.
 */
import { withAuthOnlyApi } from "@/lib/api/handler";
import { ForbiddenError } from "@/lib/errors";
import { registerOrganizationSchema } from "@/schemas/organization";
import { registerOrganization } from "@/services/organizations/register";

export const POST = withAuthOnlyApi(
  { rateLimit: { name: "register", limit: 5, windowSec: 60 }, schema: registerOrganizationSchema },
  async ({ uid, email, body }) => {
    if (!email)
      throw new ForbiddenError("An account email is required to register an organization");
    const result = await registerOrganization({
      uid,
      email,
      displayName: body.displayName,
      organizationName: body.organizationName,
    });
    return Response.json(result, { status: result.created ? 201 : 200 });
  },
);
