import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  PERMISSION_MATRIX,
  ROLES,
  ROLE_LABELS,
  can,
  type Permission,
  type Role,
} from "./permissions";

const ALL: readonly Permission[] = [
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
];

const AGENT: readonly Permission[] = [
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
];

const VIEWER: readonly Permission[] = [
  "customers:read",
  "products:read",
  "inventory:read",
  "agents:read",
  "inbox:read",
  "orders:read",
  "voice:read",
  "automations:read",
];

const EXPECTED: Record<Role, readonly Permission[]> = {
  owner: ALL,
  admin: ALL,
  agent: AGENT,
  viewer: VIEWER,
};

describe("permission constants", () => {
  it("exposes exactly the expected roles and permissions", () => {
    expect([...ROLES].sort()).toEqual(["admin", "agent", "owner", "viewer"]);
    expect([...PERMISSIONS].sort()).toEqual([...ALL].sort());
  });

  it("has a matrix entry for every role", () => {
    expect(Object.keys(PERMISSION_MATRIX).sort()).toEqual([...ROLES].sort());
  });
});

describe("can()", () => {
  for (const role of ROLES) {
    describe(role, () => {
      for (const p of PERMISSIONS) {
        const expected = EXPECTED[role].includes(p);
        it(`${expected ? "allows" : "denies"} ${p}`, () => {
          expect(can(role, p)).toBe(expected);
        });
      }
    });
  }

  it("denies null and undefined roles for every permission", () => {
    for (const p of PERMISSIONS) {
      expect(can(null, p)).toBe(false);
      expect(can(undefined, p)).toBe(false);
    }
  });

  it("denies unknown/forged roles for every permission", () => {
    for (const bogus of ["hacker", "", "OWNER", "__proto__", "constructor", "toString"]) {
      for (const p of PERMISSIONS) {
        expect(can(bogus as Role, p)).toBe(false);
      }
    }
  });

  it("denies unknown permission strings", () => {
    for (const role of ROLES) {
      expect(can(role, "nope:everything" as Permission)).toBe(false);
      expect(can(role, "" as Permission)).toBe(false);
    }
  });
});

describe("order permissions", () => {
  it("lets agents write orders, viewers only read them", () => {
    expect(can("agent", "orders:write")).toBe(true);
    expect(can("viewer", "orders:read")).toBe(true);
    expect(can("viewer", "orders:write")).toBe(false);
  });

  it("restricts integrations:manage to owner and admin", () => {
    expect(can("owner", "integrations:manage")).toBe(true);
    expect(can("admin", "integrations:manage")).toBe(true);
    expect(can("agent", "integrations:manage")).toBe(false);
    expect(can("viewer", "integrations:manage")).toBe(false);
  });
});

describe("ROLE_LABELS", () => {
  it("has a capitalised label for every role and nothing else", () => {
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...ROLES].sort());
    expect(ROLE_LABELS).toEqual({
      owner: "Owner",
      admin: "Admin",
      agent: "Agent",
      viewer: "Viewer",
    });
  });
});
