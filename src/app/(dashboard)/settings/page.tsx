import type { Metadata } from "next";

import { PageHeader } from "@/components/dashboard/page-header";
import { OrderSettingsForm } from "@/components/settings/order-settings-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";
import { can, ROLE_LABELS } from "@/lib/security/permissions";

export const metadata: Metadata = { title: "Settings" };

// Account details are read-only for now; order settings are editable by owners and admins.
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
      <Tabs defaultValue="account">
        <TabsList aria-label="Settings sections">
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
        </TabsList>
        <TabsContent value="account">
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
                  <div
                    key={label}
                    className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4"
                  >
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 font-medium break-words">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="orders">
          <OrderSettingsForm canManage={can(ctx.role, "org:manage")} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
