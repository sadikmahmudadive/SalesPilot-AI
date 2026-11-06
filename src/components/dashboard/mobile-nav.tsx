"use client";

import { useState } from "react";
import { Menu } from "lucide-react";

import { Brand } from "@/components/auth/auth-shell";
import { SidebarNav } from "@/components/dashboard/sidebar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { NavItem } from "@/config/nav";

/** Hamburger + slide-over navigation, shown below the `lg` breakpoint. */
export function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation menu">
          <Menu aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0 text-sidebar-foreground sm:max-w-72">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">Move between the sections of SalesPilot AI.</SheetDescription>
        <div className="flex h-14 shrink-0 items-center border-b px-4">
          <Brand />
        </div>
        <SidebarNav items={items} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
