import type { Metadata } from "next";

import { AnalyticsConsole } from "@/components/analytics/analytics-console";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";
import { can } from "@/lib/security/permissions";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const ctx = await requireDashboardContext();
  if (!ctx) return null;

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Sales revenue, product performance, customer growth, inbox volume, voice calls, and stock health."
      />
      {can(ctx.role, "analytics:read") ? (
        <AnalyticsConsole />
      ) : (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            You do not have permission to view analytics for this organization.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
