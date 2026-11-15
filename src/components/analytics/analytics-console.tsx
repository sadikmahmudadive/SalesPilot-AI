"use client";

import { useEffect, useState } from "react";
import {
  Banknote,
  Bot,
  Download,
  Inbox,
  Loader2,
  PackageCheck,
  Phone,
  RefreshCw,
  ShoppingCart,
  Users,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SEGMENT_LABELS } from "@/config/customer-labels";
import { ORDER_STATUS_LABELS, ORDER_STATUS_VARIANTS } from "@/config/order-labels";
import { formatCount, formatMoneyMinor } from "@/lib/format";
import {
  ANALYTICS_RANGES,
  type AnalyticsRange,
  type AnalyticsReport,
} from "@/schemas/analytics";
import { CUSTOMER_SEGMENTS } from "@/schemas/customer";
import { CONVERSATION_CHANNELS, CONVERSATION_STATUSES } from "@/schemas/inbox";
import { ORDER_STATUSES } from "@/schemas/order";

const RANGE_LABELS: Record<AnalyticsRange, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  messenger: "Messenger",
  instagram: "Instagram",
  email: "Email",
};

const INBOX_STATUS_LABELS: Record<string, string> = {
  ai_handling: "AI handling",
  needs_reply: "Needs reply",
  human_handling: "Human handling",
  resolved: "Resolved",
};

function buildCsv(report: AnalyticsReport): string {
  const lines = [
    ["Metric", "Value"].join(","),
    ["Range", report.range].join(","),
    ["Generated At", report.generatedAt].join(","),
    ["Placed Orders", String(report.sales.totalOrders)].join(","),
    ["Delivered Orders", String(report.sales.deliveredOrders)].join(","),
    ["Cancelled Orders", String(report.sales.cancelledOrders)].join(","),
    ["Gross Revenue (BDT minor)", String(report.sales.grossRevenueMinor)].join(","),
    ["Pending Revenue (BDT minor)", String(report.sales.pendingRevenueMinor)].join(","),
    ["Average Order Value (BDT minor)", String(report.sales.averageOrderValueMinor)].join(","),
    ["Total Customers", String(report.customers.totalCustomers)].join(","),
    ["New Customers In Range", String(report.customers.newCustomersInRange)].join(","),
    ["Total Conversations", String(report.inbox.totalConversations)].join(","),
    ["Total Voice Calls", String(report.operations.totalVoiceCalls)].join(","),
    "",
    ["Date (Dhaka)", "Orders", "Paid Revenue (BDT minor)"].join(","),
    ...report.sales.dailySeries.map((pt) =>
      [pt.date, String(pt.orders), String(pt.revenueMinor)].join(","),
    ),
    "",
    ["Top Product", "Quantity Sold", "Revenue (BDT minor)"].join(","),
    ...report.sales.topProducts.map((p) =>
      [`"${p.productName.replace(/"/g, '""')}"`, String(p.quantitySold), String(p.revenueMinor)].join(
        ",",
      ),
    ),
  ];
  return lines.join("\n");
}

export function AnalyticsConsole() {
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartMetric, setChartMetric] = useState<"revenue" | "orders">("revenue");

  const fetchReport = async (targetRange: AnalyticsRange) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/analytics?range=${encodeURIComponent(targetRange)}`);
      if (!res.ok) throw new Error("Failed to load analytics");
      const json = (await res.json()) as { report?: AnalyticsReport };
      if (!json.report) throw new Error("Invalid analytics response");
      setReport(json.report);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load analytics";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function loadInitial() {
      try {
        const res = await fetch("/api/analytics?range=30d");
        if (!res.ok) throw new Error("Failed to load analytics");
        const json = (await res.json()) as { report?: AnalyticsReport };
        if (!cancelled) {
          setReport(json.report ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load analytics");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectRange = (nextRange: AnalyticsRange) => {
    setRange(nextRange);
    void fetchReport(nextRange);
  };

  const handleExportCsv = () => {
    if (!report) return;
    const csv = buildCsv(report);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `salespilot-analytics-${report.range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Analytics CSV exported");
  };

  const maxDailyValue = report
    ? Math.max(
        1,
        ...report.sales.dailySeries.map((d) =>
          chartMetric === "revenue" ? d.revenueMinor : d.orders,
        ),
      )
    : 1;

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border bg-muted/40 p-1">
          {ANALYTICS_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => handleSelectRange(r)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                range === r
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void fetchReport(range)}
            disabled={loading}
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={!report || loading}
          >
            <Download className="size-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {loading && !report ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-16 text-muted-foreground">
          <Loader2 className="size-8 animate-spin mb-3" />
          <p className="text-sm">Calculating analytics from live records...</p>
        </div>
      ) : error && !report ? (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <p className="text-sm text-destructive font-medium">{error}</p>
            <Button type="button" size="sm" onClick={() => void fetchReport(range)}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : report ? (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card size="sm">
              <CardContent className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                  <span>Collected Revenue</span>
                  <Banknote className="size-4" />
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                  {formatMoneyMinor(report.sales.grossRevenueMinor)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatMoneyMinor(report.sales.pendingRevenueMinor)} awaiting collection
                </p>
              </CardContent>
            </Card>

            <Card size="sm">
              <CardContent className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                  <span>Placed Orders</span>
                  <ShoppingCart className="size-4" />
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                  {formatCount(report.sales.totalOrders)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Avg {formatMoneyMinor(report.sales.averageOrderValueMinor)} ·{" "}
                  {report.sales.deliveredOrders} delivered
                </p>
              </CardContent>
            </Card>

            <Card size="sm">
              <CardContent className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                  <span>Customer Base</span>
                  <Users className="size-4" />
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                  {formatCount(report.customers.totalCustomers)}
                </p>
                <p className="text-xs text-muted-foreground">
                  +{formatCount(report.customers.newCustomersInRange)} in period ·{" "}
                  {formatCount(report.customers.consentBreakdown.granted)} opted in
                </p>
              </CardContent>
            </Card>

            <Card size="sm">
              <CardContent className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                  <span>AI vs Staff Orders</span>
                  <Bot className="size-4" />
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                  {formatCount(report.sales.bySource.ai)} /{" "}
                  {formatCount(report.sales.bySource.staff)}
                </p>
                <p className="text-xs text-muted-foreground">
                  AI-created vs staff-created placed orders
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Daily Trend Bar Chart */}
          <Card>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Daily Sales Trend (Asia/Dhaka)</CardTitle>
                <CardDescription>
                  {report.sales.dailySeries.length === 0
                    ? "No placed orders in this range yet."
                    : `${report.sales.dailySeries.length} day window shown by calendar date.`}
                </CardDescription>
              </div>
              <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setChartMetric("revenue")}
                  className={`rounded-md px-2.5 py-1 font-medium cursor-pointer ${
                    chartMetric === "revenue" ? "bg-background shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  Revenue
                </button>
                <button
                  type="button"
                  onClick={() => setChartMetric("orders")}
                  className={`rounded-md px-2.5 py-1 font-medium cursor-pointer ${
                    chartMetric === "orders" ? "bg-background shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  Orders
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {report.sales.dailySeries.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Orders placed during this period will populate the daily trend chart.
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="flex h-44 items-end gap-1 overflow-x-auto pb-1">
                    {report.sales.dailySeries.slice(-30).map((point) => {
                      const val = chartMetric === "revenue" ? point.revenueMinor : point.orders;
                      const heightPct = val > 0 ? Math.max(6, Math.round((val / maxDailyValue) * 100)) : 2;
                      return (
                        <div
                          key={point.date}
                          className="group relative flex min-w-3 flex-1 flex-col items-center justify-end h-full"
                          title={`${point.date}: ${point.orders} order(s), ${formatMoneyMinor(point.revenueMinor)}`}
                        >
                          <div
                            className={`w-full rounded-t transition-all ${
                              val > 0 ? "bg-primary hover:bg-primary/80" : "bg-muted"
                            }`}
                            style={{ height: `${heightPct}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-[11px] text-muted-foreground">
                    <span>{report.sales.dailySeries.slice(-30)[0]?.date}</span>
                    <span>{report.sales.dailySeries.at(-1)?.date}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Breakdown Row 1: Order Funnel + Top Products */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Order Pipeline & Payment Mix</CardTitle>
                <CardDescription>
                  Status breakdown within {RANGE_LABELS[report.range].toLowerCase()}.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {ORDER_STATUSES.map((status) => (
                    <div
                      key={status}
                      className="rounded-xl border bg-muted/20 p-2.5 flex flex-col gap-1"
                    >
                      <Badge variant={ORDER_STATUS_VARIANTS[status]} className="w-fit text-[11px]">
                        {ORDER_STATUS_LABELS[status]}
                      </Badge>
                      <span className="text-lg font-semibold tabular-nums">
                        {formatCount(report.sales.byStatus[status] ?? 0)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-4 border-t pt-3 text-xs text-muted-foreground">
                  <span>COD orders: {formatCount(report.sales.codOrders)}</span>
                  <span>Online orders: {formatCount(report.sales.onlineOrders)}</span>
                  <span>Drafts: {formatCount(report.sales.draftOrders)}</span>
                  <span>Cancelled: {formatCount(report.sales.cancelledOrders)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top Products</CardTitle>
                <CardDescription>Ranked by line revenue from placed orders.</CardDescription>
              </CardHeader>
              <CardContent>
                {report.sales.topProducts.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No product sales recorded in this period.
                  </p>
                ) : (
                  <div className="divide-y text-sm">
                    {report.sales.topProducts.map((product) => (
                      <div
                        key={product.productId}
                        className="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{product.productName}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatCount(product.quantitySold)} unit(s) sold
                          </p>
                        </div>
                        <span className="shrink-0 font-semibold tabular-nums">
                          {formatMoneyMinor(product.revenueMinor)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Breakdown Row 2: Customers + Operations & Inventory */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Customer Segments & Consent</CardTitle>
                <CardDescription>Current CRM distribution across segments.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 text-sm">
                  {CUSTOMER_SEGMENTS.map((seg) => (
                    <div key={seg} className="flex items-center justify-between">
                      <span className="text-muted-foreground">{SEGMENT_LABELS[seg]}</span>
                      <span className="font-medium tabular-nums">
                        {formatCount(report.customers.bySegment[seg] ?? 0)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="border-t pt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Granted: {report.customers.consentBreakdown.granted}</span>
                  <span>Denied: {report.customers.consentBreakdown.denied}</span>
                  <span>Unknown: {report.customers.consentBreakdown.unknown}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Inbox className="size-4 text-muted-foreground" />
                  Inbox & Channel Activity
                </CardTitle>
                <CardDescription>Current conversation queue & channel split.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 text-sm">
                  {CONVERSATION_STATUSES.map((st) => (
                    <div key={st} className="flex items-center justify-between">
                      <span className="text-muted-foreground">{INBOX_STATUS_LABELS[st] ?? st}</span>
                      <span className="font-medium tabular-nums">
                        {formatCount(report.inbox.byStatus[st] ?? 0)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="border-t pt-3 space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Unread threads</span>
                    <span className="font-medium text-foreground">
                      {formatCount(report.inbox.unreadConversations)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {CONVERSATION_CHANNELS.map((ch) => (
                      <Badge key={ch} variant="outline" className="text-[11px]">
                        {CHANNEL_LABELS[ch] ?? ch}: {report.inbox.byChannel[ch] ?? 0}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PackageCheck className="size-4 text-muted-foreground" />
                  Operations & Stock Health
                </CardTitle>
                <CardDescription>Voice calls, automations & live inventory.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Phone className="size-3.5" /> Voice calls
                  </span>
                  <span className="font-medium tabular-nums">
                    {report.operations.totalVoiceCalls} ({report.operations.completedVoiceCalls} completed ·{" "}
                    {report.operations.totalTalkDurationSec}s)
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Workflow className="size-3.5" /> Active automations
                  </span>
                  <span className="font-medium tabular-nums">
                    {report.operations.activeAutomationRules} rule(s)
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Automation runs</span>
                  <span>
                    {report.operations.automationRunsSucceeded} ok ·{" "}
                    {report.operations.automationRunsSkipped} skipped ·{" "}
                    {report.operations.automationRunsFailed} failed
                  </span>
                </div>
                <div className="border-t pt-3 space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Active products / SKUs</span>
                    <span className="font-medium tabular-nums">
                      {report.inventory.activeProducts} / {report.inventory.totalSkus}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Available / Reserved</span>
                    <span className="font-medium tabular-nums">
                      {formatCount(report.inventory.totalAvailable)} /{" "}
                      {formatCount(report.inventory.totalReserved)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Low / Out of stock</span>
                    <span>
                      {report.inventory.lowStockCount} low · {report.inventory.outOfStockCount} out
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
