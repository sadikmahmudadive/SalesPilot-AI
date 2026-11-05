/**
 * Organization / membership data access. Server-only.
 *
 * Collections:
 *   users/{uid}                              { uid, email, displayName, defaultOrganizationId, createdAt }
 *   organizations/{organizationId}           { name, ownerUid, createdAt }
 *   organizationMembers/{organizationId}_{uid} { organizationId, uid, role, email, createdAt }
 */
import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { ROLES, type Role } from "@/lib/security/permissions";

export const USERS = "users";
export const ORGANIZATIONS = "organizations";
export const ORGANIZATION_MEMBERS = "organizationMembers";

export interface Membership {
  organizationId: string;
  role: Role;
}

export function memberDocId(organizationId: string, uid: string): string {
  return `${organizationId}_${uid}`;
}

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** A usable Firestore doc-id segment: non-empty string without path separators. */
function isIdSegment(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1500 && !value.includes("/");
}

/**
 * Resolves the caller's membership, failing closed (null) on anything unexpected.
 *
 * Without `organizationId` the user's default organization (`users/{uid}.defaultOrganizationId`)
 * is used. This phase supports ONLY the default organization: there is no org switching, and
 * `withApi` never passes an explicit id. In every case the member doc
 * `organizationMembers/{organizationId}_{uid}` is the authority: a `defaultOrganizationId`
 * without a matching member doc grants nothing, and a member doc with an unknown role string
 * or with `organizationId` / `uid` fields that disagree with its id is treated as no membership.
 */
export async function getMembership(uid: string, organizationId?: string): Promise<Membership | null> {
  if (!isIdSegment(uid)) return null;
  const db = adminDb();

  let orgId = organizationId;
  if (orgId === undefined) {
    const user = await db.collection(USERS).doc(uid).get();
    const fromUser: unknown = user.exists ? user.get("defaultOrganizationId") : undefined;
    if (!isIdSegment(fromUser)) return null;
    orgId = fromUser;
  }
  if (!isIdSegment(orgId)) return null;

  const member = await db.collection(ORGANIZATION_MEMBERS).doc(memberDocId(orgId, uid)).get();
  if (!member.exists) return null;
  const data = member.data();
  if (!data || data.organizationId !== orgId || data.uid !== uid || !isRole(data.role)) return null;
  return { organizationId: orgId, role: data.role };
}
