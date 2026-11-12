import type { Metadata } from "next";
import { Suspense } from "react";
import { MessageSquare, Phone } from "lucide-react";

import { KpiCard } from "@/components/dashboard/kpi-card";
import { KPI_GRID_CLASS, KpiGrid, KpiGridSkeleton } from "@/components/dashboard/kpi-grid";
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
      <div className={`${KPI_GRID_CLASS} mt-4`}>
        <KpiCard
          id="kpi-conversations"
          title="Conversations"
          icon={MessageSquare}
          state={{ kind: "later", phase: 4 }}
        />
        <KpiCard
          id="kpi-voice"
          title="Voice calls"
          icon={Phone}
          state={{ kind: "later", phase: 6 }}
        />
      </div>
    </div>
  );
}
