"use client";

import { useState } from "react";

import { Header } from "@/components/dashboard/header";
import { DesktopSidebar } from "@/components/dashboard/sidebar";
import { visibleNavItems } from "@/config/nav";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import type { Role } from "@/lib/security/permissions";

interface DashboardShellProps {
  organizationName: string;
  role: Role;
  email: string | null;
  displayName: string | null;
  children: React.ReactNode;
}

/** Signed-in chrome: skip link, collapsible sidebar (desktop), header (with mobile nav sheet) and main content. */
export function DashboardShell({ organizationName, role, email, displayName, children }: DashboardShellProps) {
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const [animate, setAnimate] = useState(false);

  return (
    <div className="flex min-h-svh flex-1">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm font-medium shadow-md ring-1 ring-border focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Skip to content
      </a>
      <DesktopSidebar
        items={visibleNavItems(role)}
        collapsed={collapsed}
        animate={animate}
        onToggle={() => {
          setAnimate(true);
          setCollapsed(!collapsed);
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header organizationName={organizationName} role={role} email={email} displayName={displayName} />
        <main id="main-content" tabIndex={-1} className="flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
