/**
 * Role -> permission matrix. Pure module (no server/client-only imports) so it can be
 * used from server actions, route handlers and client UI. The server is the enforcement
 * point; Firestore rules mirror this matrix.
 */

export const ROLES = ["owner", "admin", "agent", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** Display names for roles; the single source for UI labels. */
export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  owner: "Owner",
  admin: "Admin",
  agent: "Agent",
  viewer: "Viewer",
};

export const PERMISSIONS = [
  "org:manage",
  "members:manage",
  "customers:read",
  "customers:write",
  "products:read",
  "products:write",
  "inventory:read",
  "inventory:write",
  "uploads:customers",
  "uploads:products",
  "uploads:org",
  "audit:read",
  "agents:read",
  "agents:write",
  "agents:test",
  "inbox:read",
  "inbox:write",
  "orders:read",
  "orders:write",
  "voice:read",
  "voice:write",
  "automations:read",
  "automations:write",
  "integrations:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL_PERMISSIONS: ReadonlySet<Permission> = new Set(PERMISSIONS);

export const PERMISSION_MATRIX: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS,
  agent: new Set<Permission>([
    "customers:read",
    "customers:write",
    "products:read",
    "inventory:read",
    "uploads:customers",
    "agents:read",
    "agents:test",
    "inbox:read",
    "inbox:write",
    "orders:read",
    "orders:write",
    "voice:read",
    "voice:write",
    "automations:read",
    "automations:write",
  ]),
  viewer: new Set<Permission>([
    "customers:read",
    "products:read",
    "inventory:read",
    "agents:read",
    "inbox:read",
    "orders:read",
    "voice:read",
    "automations:read",
  ]),
};

/** True only for a known role holding a known permission; everything else is denied. */
export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (typeof role !== "string") return false;
  if (!Object.hasOwn(PERMISSION_MATRIX, role)) return false;
  return PERMISSION_MATRIX[role].has(permission);
}
