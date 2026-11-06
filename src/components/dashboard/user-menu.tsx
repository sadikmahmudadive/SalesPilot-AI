"use client";

import Link from "next/link";
import { Loader2, LogOut, Settings } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSignOut } from "@/hooks/use-sign-out";
import { initialsFor } from "@/lib/initials";
import { ROLE_LABELS, type Role } from "@/lib/security/permissions";

interface UserMenuProps {
  email: string | null;
  displayName: string | null;
  role: Role;
}

export function UserMenu({ email, displayName, role }: UserMenuProps) {
  const { signOut, pending } = useSignOut();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
          <Avatar size="default">
            <AvatarFallback className="text-xs font-medium">{initialsFor(displayName, email)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5 py-2 font-normal">
          {displayName && <span className="truncate text-sm font-medium text-foreground">{displayName}</span>}
          <span className="truncate text-xs text-muted-foreground">{email ?? "No email on file"}</span>
          <span className="text-xs text-muted-foreground">Role: {ROLE_LABELS[role]}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden="true" /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={pending}
          // Keep the menu mounted while the request runs so the spinner is visible.
          onSelect={(event) => {
            event.preventDefault();
            void signOut();
          }}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <LogOut aria-hidden="true" />}
          {pending ? "Signing out..." : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
