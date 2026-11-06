import type { Metadata } from "next";

import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";

export const metadata: Metadata = { title: "Overview" };

// Minimal placeholder: Task 22 replaces this with the real overview. No metrics are shown until they are real.
export default async function DashboardPage() {
  const ctx = await requireDashboardContext();
  if (!ctx) return null;

  const name = ctx.displayName ?? ctx.email ?? "there";
  return (
    <div>
      <PageHeader
        title={`Welcome, ${name}`}
        description={`You are working in ${ctx.organizationName}. Your workspace is ready.`}
      />
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-base font-medium">Getting started</h2>
          </CardTitle>
          <CardDescription>
            Your overview will summarise sales, conversations and stock here once there is real activity to show.
            Until then, customers, products and inventory are the places to start.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Other sections in the sidebar are marked as coming soon and will appear in later releases.
        </CardContent>
      </Card>
    </div>
  );
}
