import { Bell } from "lucide-react";
import { describe, expect, it } from "vitest";

import { PROTECTED_PREFIXES } from "@/lib/auth/redirect";
import { ROLES, type Role } from "@/lib/security/permissions";

import { NAV_ITEMS, findNavItem, isNavActive, visibleNavItems, type NavItem } from "./nav";

const ORDER = [
  ["Overview", "/dashboard"],
  ["Unified Inbox", "/inbox"],
  ["AI Agents", "/agents"],
  ["Customers", "/customers"],
  ["Products", "/products"],
  ["Inventory", "/inventory"],
  ["Orders", "/orders"],
  ["Voice Calls", "/voice"],
  ["Automations", "/automations"],
  ["Analytics", "/analytics"],
  ["Integrations", "/integrations"],
  ["Settings", "/settings"],
] as const;

describe("NAV_ITEMS", () => {
  it("has exactly 12 entries in the brief's order", () => {
    expect(NAV_ITEMS.map((i) => [i.label, i.href])).toEqual(ORDER);
  });

  it("has unique hrefs and labels, and every item has an icon", () => {
    expect(new Set(NAV_ITEMS.map((i) => i.href)).size).toBe(12);
    expect(new Set(NAV_ITEMS.map((i) => i.label)).size).toBe(12);
    for (const item of NAV_ITEMS) expect(item.icon).toBeTruthy();
  });

  it("matches the protected route prefixes exactly (both directions)", () => {
    expect([...NAV_ITEMS.map((i) => i.href)].sort()).toEqual([...PROTECTED_PREFIXES].sort());
  });

  it("only the pages built so far have no phase", () => {
    const built = NAV_ITEMS.filter((i) => i.phase === undefined).map((i) => i.label);
    expect(built).toEqual([
      "Overview",
      "Unified Inbox",
      "AI Agents",
      "Customers",
      "Products",
      "Inventory",
      "Orders",
      "Voice Calls",
      "Automations",
      "Analytics",
      "Integrations",
      "Settings",
    ]);
  });

  it("assigns the planned phases", () => {
    const phases = Object.fromEntries(
      NAV_ITEMS.filter((i) => i.phase).map((i) => [i.href, i.phase]),
    );
    expect(phases).toEqual({});
  });

  it("gates inbox, customers, products, inventory, agents, voice, automations, analytics and integrations on permissions", () => {
    const perms = Object.fromEntries(
      NAV_ITEMS.filter((i) => i.permission).map((i) => [i.href, i.permission]),
    );
    expect(perms).toEqual({
      "/inbox": "inbox:read",
      "/agents": "agents:read",
      "/customers": "customers:read",
      "/products": "products:read",
      "/inventory": "inventory:read",
      "/voice": "voice:read",
      "/automations": "automations:read",
      "/analytics": "analytics:read",
      "/integrations": "integrations:manage",
    });
  });
});

describe("visibleNavItems", () => {
  it("shows a viewer the built pages plus the phase placeholders (excluding admin/integrations)", () => {
    const labels = visibleNavItems("viewer").map((i) => i.label);
    for (const l of ["Overview", "Customers", "Products", "Inventory", "Settings"])
      expect(labels).toContain(l);
    expect(labels).toHaveLength(11);
    expect(labels).not.toContain("Integrations");
  });

  it.each(ROLES)("returns items in nav order for %s", (role: Role) => {
    const hrefs = visibleNavItems(role).map((i) => i.href);
    expect(hrefs).toEqual(NAV_ITEMS.filter((i) => hrefs.includes(i.href)).map((i) => i.href));
  });

  it("hides items whose permission the role lacks", () => {
    const items: NavItem[] = [
      { label: "Open", href: "/dashboard", icon: Bell },
      { label: "Admin only", href: "/settings", icon: Bell, permission: "org:manage" },
      { label: "Read", href: "/customers", icon: Bell, permission: "customers:read" },
    ];
    expect(visibleNavItems("viewer", items).map((i) => i.label)).toEqual(["Open", "Read"]);
    expect(visibleNavItems("agent", items).map((i) => i.label)).toEqual(["Open", "Read"]);
    expect(visibleNavItems("admin", items).map((i) => i.label)).toEqual([
      "Open",
      "Admin only",
      "Read",
    ]);
    expect(visibleNavItems("owner", items).map((i) => i.label)).toEqual([
      "Open",
      "Admin only",
      "Read",
    ]);
  });

  it("fails closed for an unknown role", () => {
    const labels = visibleNavItems("hacker" as Role).map((i) => i.label);
    expect(labels).not.toContain("Customers");
    expect(labels).toContain("Overview");
  });
});

describe("findNavItem", () => {
  it("matches exact paths and sub-paths", () => {
    expect(findNavItem("/customers")?.label).toBe("Customers");
    expect(findNavItem("/customers/abc/edit")?.label).toBe("Customers");
    expect(findNavItem("/dashboard")?.label).toBe("Overview");
  });

  it("does not match look-alike prefixes or unknown paths", () => {
    expect(findNavItem("/customersfoo")).toBeUndefined();
    expect(findNavItem("/")).toBeUndefined();
    expect(findNavItem("/login")).toBeUndefined();
    expect(findNavItem(null)).toBeUndefined();
  });
});

describe("isNavActive", () => {
  it("is true for the exact path and real sub-paths only", () => {
    expect(isNavActive("/customers", "/customers")).toBe(true);
    expect(isNavActive("/customers/42", "/customers")).toBe(true);
    expect(isNavActive("/customersfoo", "/customers")).toBe(false);
    expect(isNavActive("/dashboard", "/customers")).toBe(false);
    expect(isNavActive(null, "/customers")).toBe(false);
  });
});
