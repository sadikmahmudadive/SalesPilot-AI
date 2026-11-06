import type { Metadata } from "next";

import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";
import { ROLE_LABELS } from "@/lib/security/permissions";

export const metadata: Metadata = { title: "Settings" };

// Read-only for now: editing organization and profile details arrives with later tasks.
export default async function SettingsPage() {
  const ctx = await requireDashboardContext();
  if (!ctx) return null;

  const rows: Array<[label: string, value: string]> = [
    ["Organization", ctx.organizationName],
    ["Your email", ctx.email ?? "Not available"],
    ["Your role", ROLE_LABELS[ctx.role]],
  ];

  return (
    <div>
      <PageHeader title="Settings" description="Details of your organization and account." />
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-base font-medium">Account</h2>
          </CardTitle>
          <CardDescription>These details are read-only for now.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 font-medium break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
