import type { Metadata } from "next";
import { Suspense } from "react";

import {
  ActivityKpiGrid,
  ActivityKpiGridSkeleton,
  KpiGrid,
  KpiGridSkeleton,
} from "@/components/dashboard/kpi-grid";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";

export const metadata: Metadata = { title: "Overview" };

// Reads the session (cookies) via requireDashboardContext, so this renders per request; the counts are
// never cached. The header streams immediately and the live cards fill in behind a skeleton.
export default async function DashboardPage() {
  const ctx = await requireDashboardContext();
  if (!ctx) return null;

  const name = ctx.displayName ?? ctx.email ?? "there";
  return (
    <div>
      <PageHeader
        title={`Welcome, ${name}`}
        description={`Here is where ${ctx.organizationName} stands today.`}
      />
      <Suspense fallback={<KpiGridSkeleton />}>
        <KpiGrid organizationId={ctx.organizationId} />
      </Suspense>
      <Suspense fallback={<ActivityKpiGridSkeleton />}>
        <ActivityKpiGrid organizationId={ctx.organizationId} />
      </Suspense>
    </div>
  );
}
