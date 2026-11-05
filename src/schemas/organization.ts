import { z } from "zod";

/**
 * Body of POST /api/organizations/register. Only the display fields come from the client:
 * `uid` and `email` are taken from the verified session. Unknown keys are stripped.
 */
export const registerOrganizationSchema = z.object({
  organizationName: z.string().trim().min(2).max(80),
  displayName: z.string().trim().min(1).max(80),
});

export type RegisterOrganizationBody = z.infer<typeof registerOrganizationSchema>;
