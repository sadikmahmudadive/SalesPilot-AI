/**
 * Dashboard navigation. Pure data plus two helpers; safe for server and client components.
 *
 * `permission` filtering is COSMETIC: it only hides links a role could not use. Access is
 * enforced by the server (route handlers, services, Firestore rules), never by this list.
 * Every `href` must be a protected prefix (`PROTECTED_PREFIXES`) so the proxy guards it;
 * a unit test keeps the two in sync.
 */
import {
  BarChart3,
  Bot,
  Boxes,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  PackageSearch,
  Phone,
  Plug,
  Settings,
  ShoppingCart,
  Users,
  Workflow,
} from "lucide-react";

import { can, type Permission, type Role } from "@/lib/security/permissions";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Hidden from roles lacking this permission (cosmetic only). */
  permission?: Permission;
  /** Roadmap phase that builds the page. Items without a phase exist in this plan. */
  phase?: number;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Unified Inbox", href: "/inbox", icon: Inbox, phase: 4 },
  { label: "AI Agents", href: "/agents", icon: Bot, permission: "agents:read" },
  { label: "Customers", href: "/customers", icon: Users, permission: "customers:read" },
  { label: "Products", href: "/products", icon: Boxes, permission: "products:read" },
  { label: "Inventory", href: "/inventory", icon: PackageSearch, permission: "inventory:read" },
  { label: "Orders", href: "/orders", icon: ShoppingCart, phase: 5 },
  { label: "Voice Calls", href: "/voice", icon: Phone, phase: 6 },
  { label: "Automations", href: "/automations", icon: Workflow, phase: 7 },
  { label: "Analytics", href: "/analytics", icon: BarChart3, phase: 8 },
  { label: "Integrations", href: "/integrations", icon: Plug, phase: 8 },
  { label: "Settings", href: "/settings", icon: Settings },
];

/** Items the role may see, in nav order. Unknown roles fail closed (permission-gated items are hidden). */
export function visibleNavItems(role: Role, items: readonly NavItem[] = NAV_ITEMS): NavItem[] {
  return items.filter((item) => item.permission === undefined || can(role, item.permission));
}

/** True when `pathname` is `href` or a real sub-path of it (`/customersfoo` is not under `/customers`). */
export function isNavActive(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The nav item for `pathname` (exact or parent path), if any. */
export function findNavItem(pathname: string | null | undefined): NavItem | undefined {
  return NAV_ITEMS.find((item) => isNavActive(pathname, item.href));
}
