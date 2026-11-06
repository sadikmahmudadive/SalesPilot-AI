"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Brand } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isNavActive, type NavItem } from "@/config/nav";
import { cn } from "@/lib/utils";

interface SidebarNavProps {
  items: NavItem[];
  /** Icon-only presentation (desktop sidebar when collapsed). */
  collapsed?: boolean;
  /** Called after a link is chosen (closes the mobile sheet). */
  onNavigate?: () => void;
}

function NavLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "relative flex h-9 items-center gap-3 rounded-md px-3 text-sm outline-none transition-colors",
        "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "focus-visible:ring-3 focus-visible:ring-sidebar-ring/50",
        "before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-foreground before:opacity-0 before:transition-opacity",
        active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground before:opacity-100",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className={cn("truncate", collapsed && "sr-only")}>{item.label}</span>
      {item.phase !== undefined && !collapsed && (
        <span className="ml-auto rounded-full border px-1.5 py-px text-[0.65rem] leading-4 font-normal text-muted-foreground">
          Soon
        </span>
      )}
      {item.phase !== undefined && collapsed && <span className="sr-only">(coming soon)</span>}
    </Link>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  );
}

/** The primary navigation list, shared by the desktop sidebar and the mobile sheet. */
export function SidebarNav({ items, collapsed = false, onNavigate }: SidebarNavProps) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex-1 overflow-y-auto px-2 py-3">
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => (
          <li key={item.href}>
            <NavLink
              item={item}
              active={isNavActive(pathname, item.href)}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

interface DesktopSidebarProps {
  items: NavItem[];
  collapsed: boolean;
  /** Width transition only after the user toggles, so a remembered collapsed state does not animate on load. */
  animate: boolean;
  onToggle: () => void;
}

/** Collapsible sidebar, visible from the `lg` breakpoint up. */
export function DesktopSidebar({ items, collapsed, animate, onToggle }: DesktopSidebarProps) {
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "sticky top-0 hidden h-svh shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground lg:flex",
        collapsed ? "w-16" : "w-64",
        animate && "transition-[width] duration-200 ease-out motion-reduce:transition-none",
      )}
    >
      <div className={cn("flex h-14 shrink-0 items-center border-b px-4", collapsed && "justify-center px-0")}>
        {collapsed ? (
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
            <Compass className="size-4" aria-hidden="true" />
            <span className="sr-only">SalesPilot AI</span>
          </span>
        ) : (
          <Brand />
        )}
      </div>
      <SidebarNav items={items} collapsed={collapsed} />
      <div className={cn("flex shrink-0 border-t p-2", collapsed && "justify-center")}>
        <Button
          type="button"
          variant="ghost"
          size={collapsed ? "icon" : "sm"}
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="text-sidebar-foreground/70"
        >
          <ToggleIcon aria-hidden="true" />
          {!collapsed && <span>Collapse</span>}
        </Button>
      </div>
    </aside>
  );
}
