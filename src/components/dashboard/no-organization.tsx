"use client";

import Link from "next/link";
import { Building2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSignOut } from "@/hooks/use-sign-out";

/** Shown in place of the dashboard when the account has no organization. No redirect, so it can never loop. */
export function NoOrganization({ email }: { email: string | null }) {
  const { signOut, pending } = useSignOut();
  return (
    <main id="main-content" className="flex min-h-svh flex-1 items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <span className="mb-2 flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Building2 className="size-5" aria-hidden="true" />
          </span>
          <CardTitle>
            <h1 className="text-lg font-semibold">No organization found</h1>
          </CardTitle>
          <CardDescription>
            {email ? `${email} is` : "This account is"} not part of an organization yet. Set one up to start using
            SalesPilot AI.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button asChild size="lg">
            <Link href="/onboarding">Set up your organization</Link>
          </Button>
          <Button type="button" variant="ghost" size="lg" onClick={() => void signOut()} disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Sign out
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
