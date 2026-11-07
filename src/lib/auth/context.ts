/**
 * Authenticated request context. Server-only.
 *
 * `organizationId` and `role` are ALWAYS derived from the verified session user plus the
 * membership document, never from anything the client sends.
 */
import "server-only";

import { requireUser, type SessionUser } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/errors";
import type { Role } from "@/lib/security/permissions";
import { getMembership } from "@/repositories/organizations";

export interface OrgContext {
  uid: string;
  email: string | null;
  organizationId: string;
  role: Role;
}

/** Adds the caller's (default-organization) membership to an authenticated user. 403 if none. */
export async function requireMembership(user: SessionUser): Promise<OrgContext> {
  const membership = await getMembership(user.uid);
  if (!membership) throw new ForbiddenError("No organization membership");
  return {
    uid: user.uid,
    email: user.email,
    organizationId: membership.organizationId,
    role: membership.role,
  };
}

/** Session user (401 if absent) plus membership (403 if absent). */
export async function requireOrgContext(): Promise<OrgContext> {
  return requireMembership(await requireUser());
}
