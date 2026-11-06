"use client";

import { Search } from "lucide-react";

import { MobileNav } from "@/components/dashboard/mobile-nav";
import { StatusChip } from "@/components/dashboard/status-chip";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { roleLabel, UserMenu } from "@/components/dashboard/user-menu";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { visibleNavItems } from "@/config/nav";
import type { Role } from "@/lib/security/permissions";

const SEARCH_TITLE = "Search is coming in a later release";

interface HeaderProps {
  organizationName: string;
  role: Role;
  email: string | null;
  displayName: string | null;
}

export function Header({ organizationName, role, email, displayName }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-backdrop-filter:bg-background/70 sm:gap-3 sm:px-6">
      <MobileNav items={visibleNavItems(role)} />

      <div className="flex min-w-0 items-center gap-2">
        <span className="max-w-40 truncate text-sm font-medium sm:max-w-56" title={organizationName}>
          {organizationName}
        </span>
        <Badge variant="secondary" className="hidden sm:inline-flex">
          {roleLabel(role)}
        </Badge>
      </div>

      <div className="mx-auto hidden w-full max-w-sm md:block" title={SEARCH_TITLE}>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            disabled
            aria-disabled="true"
            aria-label="Search (coming in a later release)"
            placeholder="Search"
            title={SEARCH_TITLE}
            className="pl-8"
          />
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1 sm:gap-2 md:ml-0">
        <StatusChip className="hidden sm:inline-flex" />
        <ThemeToggle />
        <UserMenu email={email} displayName={displayName} role={role} />
      </div>
    </header>
  );
}
