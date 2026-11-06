/**
 * Per-request context for the signed-in area. Server-only.
 *
 * `loadDashboardContext` is wrapped in React `cache`, so the layout and the page of one request share
 * a single set of Firestore reads. Role and organization come from the verified session plus the
 * membership document, never from the client. Next layouts do not re-render on soft navigation, so
 * pages that need this data call `requireDashboardContext()` themselves.
 */
import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { REQUEST_PATH_HEADER, safeNextPath } from "@/lib/auth/redirect";
import { getCurrentUser } from "@/lib/auth/session";
import type { Role } from "@/lib/security/permissions";
import { getMembership, getOrganization, getUserDisplayName } from "@/repositories/organizations";

const FALLBACK_ORG_NAME = "Your organization";

export type DashboardContext =
  | { status: "unauthenticated" }
  | { status: "no-organization"; email: string | null }
  | {
      status: "ready";
      uid: string;
      email: string | null;
      displayName: string | null;
      organizationId: string;
      organizationName: string;
      role: Role;
    };

export type ReadyDashboardContext = Extract<DashboardContext, { status: "ready" }>;

export const loadDashboardContext = cache(async (): Promise<DashboardContext> => {
  const user = await getCurrentUser();
  if (!user) return { status: "unauthenticated" };

  const membership = await getMembership(user.uid);
  if (!membership) return { status: "no-organization", email: user.email };

  const [organization, displayName] = await Promise.all([
    getOrganization(membership.organizationId),
    getUserDisplayName(user.uid),
  ]);
  return {
    status: "ready",
    uid: user.uid,
    email: user.email,
    displayName,
    organizationId: membership.organizationId,
    organizationName: organization?.name ?? FALLBACK_ORG_NAME,
    role: membership.role,
  };
});

/**
 * Sends an invalid / expired session to `/api/auth/expired`, which clears the stale cookie (a server
 * component cannot) and redirects to /login. The `next` value comes from the proxy-set request header
 * and is validated; if it is absent the post-login default is used.
 */
export async function redirectToExpiredSession(): Promise<never> {
  const requested = (await headers()).get(REQUEST_PATH_HEADER);
  redirect(`/api/auth/expired?next=${encodeURIComponent(safeNextPath(requested))}`);
}

/**
 * For pages: the ready context, or null when the user has no organization (the layout shows its
 * "no organization" panel instead of the page, so the page just renders nothing).
 */
export async function requireDashboardContext(): Promise<ReadyDashboardContext | null> {
  const ctx = await loadDashboardContext();
  if (ctx.status === "unauthenticated") return redirectToExpiredSession();
  return ctx.status === "ready" ? ctx : null;
}
