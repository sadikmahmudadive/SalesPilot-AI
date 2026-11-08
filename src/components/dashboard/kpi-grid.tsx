import { Boxes, TriangleAlert, UserPlus, Users } from "lucide-react";

import { KpiCard, KpiCardSkeleton, type KpiState } from "@/components/dashboard/kpi-card";
import { SEGMENT_LABELS } from "@/config/customer-labels";
import { LOW_STOCK_THRESHOLD } from "@/config/inventory";
import { getOverview, type Metric } from "@/services/dashboard/overview";
import { LEAD_SEGMENTS } from "@/services/dashboard/lead-segments";

/** Responsive grid shared by the live cards, their skeleton and the later-phase cards. */
export const KPI_GRID_CLASS = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4";

const stateOf = (metric: Metric): KpiState =>
  metric.ok ? { kind: "value", value: metric.value } : { kind: "error" };

const LEAD_SUBTEXT = `Customers who are ${LEAD_SEGMENTS.map((s) => SEGMENT_LABELS[s].toLowerCase()).join(", ")}.`;

/** The four live cards. Async server component: awaits the counts (each can fail on its own). */
export async function KpiGrid({ organizationId }: { organizationId: string }) {
  const overview = await getOverview(organizationId);
  return (
    <div className={KPI_GRID_CLASS}>
      <KpiCard
        id="kpi-customers"
        title="Customers"
        icon={Users}
        state={stateOf(overview.customers)}
        subtext="All customers in your organization."
        href="/customers"
        linkLabel="View customers"
      />
      <KpiCard
        id="kpi-leads"
        title="Leads"
        icon={UserPlus}
        state={stateOf(overview.leads)}
        subtext={LEAD_SUBTEXT}
        href="/customers"
        linkLabel="View all customers"
      />
      <KpiCard
        id="kpi-products"
        title="Products"
        icon={Boxes}
        state={stateOf(overview.products)}
        subtext="Not archived (includes drafts)."
        href="/products"
        linkLabel="View products"
      />
      <KpiCard
        id="kpi-low-stock"
        title="Low stock"
        icon={TriangleAlert}
        state={stateOf(overview.lowStock)}
        subtext={`Stock units (variants) with ${LOW_STOCK_THRESHOLD} or fewer available, including never-stocked units.`}
        href="/inventory?lowStock=true"
        linkLabel="View low stock"
      />
    </div>
  );
}

export function KpiGridSkeleton() {
  return (
    <div className={KPI_GRID_CLASS} role="status" aria-label="Loading overview figures">
      {Array.from({ length: 4 }, (_, i) => (
        <KpiCardSkeleton key={i} />
      ))}
    </div>
  );
}
