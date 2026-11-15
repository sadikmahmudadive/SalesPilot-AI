/**
 * Organization / membership data access. Server-only.
 *
 * Collections:
 *   users/{uid}                              { uid, email, displayName, defaultOrganizationId, createdAt }
 *   organizations/{organizationId}           { name, ownerUid, createdAt }
 *   organizationMembers/{organizationId}_{uid} { organizationId, uid, role, email, createdAt }
 */
import "server-only";

import { cache } from "react";

import { adminDb } from "@/lib/firebase/admin";
import { ROLES, type Role } from "@/lib/security/permissions";

export const USERS = "users";
export const ORGANIZATIONS = "organizations";
export const ORGANIZATION_MEMBERS = "organizationMembers";

export interface Membership {
  organizationId: string;
  role: Role;
}

const LOOKUP_CACHE_TTL_MS = 20_000;
const LOOKUP_CACHE_MAX = 500;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const userDocCache = new Map<string, CacheEntry<Record<string, unknown>>>();
const membershipCache = new Map<string, CacheEntry<Membership>>();
const organizationCache = new Map<string, CacheEntry<OrganizationSummary>>();

function isLookupCacheEnabled(): boolean {
  return process.env.NODE_ENV !== "test";
}

function getCachedLookup<T>(map: Map<string, CacheEntry<T>>, key: string): T | undefined {
  if (!isLookupCacheEnabled()) return undefined;
  const entry = map.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt > Date.now()) return entry.value;
  map.delete(key);
  return undefined;
}

function setCachedLookup<T>(map: Map<string, CacheEntry<T>>, key: string, value: T): void {
  if (!isLookupCacheEnabled()) return;
  if (map.size >= LOOKUP_CACHE_MAX) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
  map.set(key, { value, expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS });
}

/**
 * Deduplicates `users/{uid}` reads across `getMembership(uid)` and `getUserDisplayName(uid)`
 * within a single React server render and across short bursts in non-test environments.
 */
const readUserDocData = cache(
  async (uid: string): Promise<Record<string, unknown> | undefined> => {
    const cached = getCachedLookup(userDocCache, uid);
    if (cached !== undefined) return cached;

    const snap = await adminDb().collection(USERS).doc(uid).get();
    if (!snap.exists) return undefined;
    const data = snap.data();
    if (!data) return undefined;
    setCachedLookup(userDocCache, uid, data);
    return data;
  },
);

export function memberDocId(organizationId: string, uid: string): string {
  return `${organizationId}_${uid}`;
}

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** A usable Firestore doc-id segment: non-empty string without path separators. */
function isIdSegment(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= 1500 && !value.includes("/")
  );
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
export async function getMembership(
  uid: string,
  organizationId?: string,
): Promise<Membership | null> {
  if (!isIdSegment(uid)) return null;

  let orgId = organizationId;
  if (orgId === undefined) {
    const userData = await readUserDocData(uid);
    const fromUser: unknown = userData?.defaultOrganizationId;
    if (!isIdSegment(fromUser)) return null;
    orgId = fromUser;
  }
  if (!isIdSegment(orgId)) return null;

  const docId = memberDocId(orgId, uid);
  const cachedMember = getCachedLookup(membershipCache, docId);
  if (cachedMember !== undefined) return cachedMember;

  const member = await adminDb().collection(ORGANIZATION_MEMBERS).doc(docId).get();
  if (!member.exists) return null;
  const data = member.data();
  if (!data || data.organizationId !== orgId || data.uid !== uid || !isRole(data.role)) return null;
  const result: Membership = { organizationId: orgId, role: data.role };
  setCachedLookup(membershipCache, docId, result);
  return result;
}

export interface OrganizationSummary {
  id: string;
  name: string;
}

/** Display fields of an organization, or null when it is missing or malformed. Callers must already have verified membership. */
export async function getOrganization(organizationId: string): Promise<OrganizationSummary | null> {
  if (!isIdSegment(organizationId)) return null;
  const cached = getCachedLookup(organizationCache, organizationId);
  if (cached !== undefined) return cached;

  const snap = await adminDb().collection(ORGANIZATIONS).doc(organizationId).get();
  if (!snap.exists) return null;
  const name: unknown = snap.get("name");
  if (typeof name !== "string" || name.trim().length === 0) return null;
  const summary: OrganizationSummary = { id: organizationId, name };
  setCachedLookup(organizationCache, organizationId, summary);
  return summary;
}

/** The user's display name from `users/{uid}`, or null when absent. Cosmetic only (greetings, avatars). */
export async function getUserDisplayName(uid: string): Promise<string | null> {
  if (!isIdSegment(uid)) return null;
  const data = await readUserDocData(uid);
  const name: unknown = data?.displayName;
  return typeof name === "string" && name.trim().length > 0 ? name.trim() : null;
}
