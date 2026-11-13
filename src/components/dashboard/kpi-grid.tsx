import {
  Banknote,
  Boxes,
  MessageSquare,
  Phone,
  ShoppingCart,
  TriangleAlert,
  UserPlus,
  Users,
} from "lucide-react";

import { KpiCard, KpiCardSkeleton, type KpiState } from "@/components/dashboard/kpi-card";
import { SEGMENT_LABELS } from "@/config/customer-labels";
import { LOW_STOCK_THRESHOLD } from "@/config/inventory";
import { formatMoneyMinor } from "@/lib/format";
import { getActivityOverview, getOverview, type Metric } from "@/services/dashboard/overview";
import { LEAD_SEGMENTS } from "@/services/dashboard/lead-segments";

/** Responsive grid shared by the live cards, their skeleton and the later-phase cards. */
export const KPI_GRID_CLASS = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4";

const stateOf = (metric: Metric): KpiState =>
  metric.ok ? { kind: "value", value: metric.value } : { kind: "error" };

const LEAD_SUBTEXT = `Customers who are ${LEAD_SEGMENTS.map((s) => SEGMENT_LABELS[s].toLowerCase()).join(", ")}.`;

/** The six live cards. Async server component: awaits the counts (each can fail on its own). */
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
      <KpiCard
        id="kpi-orders-today"
        title="Orders today"
        icon={ShoppingCart}
        state={stateOf(overview.ordersToday)}
        subtext="Placed since midnight (Dhaka time), not counting drafts or cancelled orders."
        href="/orders"
        linkLabel="View orders"
      />
      <KpiCard
        id="kpi-revenue-month"
        title="Revenue this month (paid + COD collected)"
        icon={Banknote}
        state={stateOf(overview.revenueMonthMinor)}
        subtext="Orders created this month (Dhaka time) whose payment has been received."
        href="/orders"
        linkLabel="View orders"
        format={formatMoneyMinor}
      />
    </div>
  );
}

export function KpiGridSkeleton() {
  return (
    <div className={KPI_GRID_CLASS} role="status" aria-label="Loading overview figures">
      {Array.from({ length: 6 }, (_, i) => (
        <KpiCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Live conversation and voice call cards. Async server component. */
export async function ActivityKpiGrid({ organizationId }: { organizationId: string }) {
  const activity = await getActivityOverview(organizationId);
  return (
    <div className={`${KPI_GRID_CLASS} mt-4`}>
      <KpiCard
        id="kpi-conversations"
        title="Conversations"
        icon={MessageSquare}
        state={stateOf(activity.conversations)}
        subtext="Customer threads across WhatsApp and inbox channels."
        href="/inbox"
        linkLabel="View inbox"
      />
      <KpiCard
        id="kpi-voice"
        title="Voice calls"
        icon={Phone}
        state={stateOf(activity.voiceCalls)}
        subtext="AI and telephony calls placed or received."
        href="/voice"
        linkLabel="View voice calls"
      />
    </div>
  );
}

export function ActivityKpiGridSkeleton() {
  return (
    <div className={`${KPI_GRID_CLASS} mt-4`} role="status" aria-label="Loading activity figures">
      <KpiCardSkeleton />
      <KpiCardSkeleton />
    </div>
  );
}
