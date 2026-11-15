/**
 * Organization-scoped analytics aggregator. Server-only.
 */
import "server-only";

import { LOW_STOCK_THRESHOLD } from "@/config/inventory";
import { adminDb } from "@/lib/firebase/admin";
import { isValidIdSegment } from "@/lib/ids";
import { invalid } from "@/lib/validation-error";
import { AUTOMATION_RULES, AUTOMATION_RUNS } from "@/repositories/automations";
import { CONVERSATIONS } from "@/repositories/conversations";
import { CUSTOMERS } from "@/repositories/customers";
import { ORDERS } from "@/repositories/orders";
import { INVENTORY, PRODUCTS } from "@/repositories/products";
import { VOICE_CALLS } from "@/repositories/voice";
import {
  ORDER_SOURCES,
  type AnalyticsCustomerSummary,
  type AnalyticsInboxSummary,
  type AnalyticsInventorySummary,
  type AnalyticsOperationsSummary,
  type AnalyticsRange,
  type AnalyticsReport,
  type AnalyticsSalesSummary,
  type DailyOrderPoint,
  type OrderSource,
} from "@/schemas/analytics";
import { CUSTOMER_SEGMENTS, type CustomerSegment } from "@/schemas/customer";
import {
  CONVERSATION_CHANNELS,
  CONVERSATION_STATUSES,
  type ConversationChannel,
  type ConversationStatus,
} from "@/schemas/inbox";
import { ORDER_STATUSES, type OrderLine, type OrderStatus } from "@/schemas/order";
import { dhakaDayStart } from "@/services/dashboard/dhaka-time";

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Formats an instant as YYYY-MM-DD in Asia/Dhaka (UTC+6). */
export function dhakaDateString(date: Date): string {
  const local = new Date(date.getTime() + DHAKA_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Inclusive cutoff Date in Asia/Dhaka for the requested range, or null for "all". */
export function rangeCutoffDate(range: AnalyticsRange, now: Date): Date | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const todayStart = dhakaDayStart(now);
  return new Date(todayStart.getTime() - (days - 1) * DAY_MS);
}

/** Coerces Firestore Timestamp, Date, or ISO string to Date. */
export function toDateValue(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string") {
    const parsed = new Date(v);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (
    v !== null &&
    typeof v === "object" &&
    "toDate" in v &&
    typeof (v as { toDate?: unknown }).toDate === "function"
  ) {
    const d = (v as { toDate: () => Date }).toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  return null;
}

export interface OrderAnalyticsRecord {
  status: string;
  source?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  totalMinor?: number;
  lines?: Array<Partial<OrderLine>>;
  createdAt?: unknown;
}

export function aggregateOrders(
  orders: readonly OrderAnalyticsRecord[],
  range: AnalyticsRange,
  now: Date,
): AnalyticsSalesSummary {
  const cutoff = rangeCutoffDate(range, now);
  const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<
    OrderStatus,
    number
  >;
  const bySource = Object.fromEntries(ORDER_SOURCES.map((s) => [s, 0])) as Record<
    OrderSource,
    number
  >;

  const dayMap = new Map<string, DailyOrderPoint>();
  if (range !== "all") {
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    const todayStart = dhakaDayStart(now);
    for (let i = days - 1; i >= 0; i--) {
      const dateStr = dhakaDateString(new Date(todayStart.getTime() - i * DAY_MS));
      dayMap.set(dateStr, { date: dateStr, orders: 0, revenueMinor: 0 });
    }
  }

  const productMap = new Map<
    string,
    { productId: string; productName: string; quantitySold: number; revenueMinor: number }
  >();

  let totalOrders = 0;
  let draftOrders = 0;
  let cancelledOrders = 0;
  let deliveredOrders = 0;
  let returnedOrders = 0;
  let grossRevenueMinor = 0;
  let pendingRevenueMinor = 0;
  let placedTotalMinor = 0;
  let codOrders = 0;
  let onlineOrders = 0;

  for (const order of orders) {
    const createdAt = toDateValue(order.createdAt);
    if (cutoff && (!createdAt || createdAt < cutoff)) continue;

    if (order.status in byStatus) {
      byStatus[order.status as OrderStatus] += 1;
    }

    if (order.status === "draft") {
      draftOrders += 1;
      continue;
    }
    if (order.status === "cancelled") {
      cancelledOrders += 1;
      continue;
    }

    totalOrders += 1;
    if (order.status === "delivered") deliveredOrders += 1;
    if (order.status === "returned") returnedOrders += 1;

    if (order.source === "ai" || order.source === "staff") {
      bySource[order.source] += 1;
    }

    if (order.paymentMethod === "cod") codOrders += 1;
    else if (order.paymentMethod === "online") onlineOrders += 1;

    const totalMinor = typeof order.totalMinor === "number" ? order.totalMinor : 0;
    placedTotalMinor += totalMinor;

    const isPaid = order.paymentStatus === "paid" || order.paymentStatus === "cod_collected";
    if (isPaid) {
      grossRevenueMinor += totalMinor;
    } else if (
      order.paymentStatus === "cod_pending" ||
      order.paymentStatus === "awaiting_payment"
    ) {
      pendingRevenueMinor += totalMinor;
    }

    if (createdAt) {
      const dateKey = dhakaDateString(createdAt);
      const bucket = dayMap.get(dateKey) ?? { date: dateKey, orders: 0, revenueMinor: 0 };
      bucket.orders += 1;
      if (isPaid) bucket.revenueMinor += totalMinor;
      dayMap.set(dateKey, bucket);
    }

    if (Array.isArray(order.lines)) {
      for (const line of order.lines) {
        if (!line.productId) continue;
        const qty = typeof line.quantity === "number" ? line.quantity : 0;
        const rev = typeof line.lineTotalMinor === "number" ? line.lineTotalMinor : 0;
        const existing = productMap.get(line.productId) ?? {
          productId: line.productId,
          productName: line.productName ?? line.productId,
          quantitySold: 0,
          revenueMinor: 0,
        };
        existing.quantitySold += qty;
        existing.revenueMinor += rev;
        productMap.set(line.productId, existing);
      }
    }
  }

  const dailySeries = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const topProducts = [...productMap.values()]
    .sort((a, b) => b.revenueMinor - a.revenueMinor || b.quantitySold - a.quantitySold)
    .slice(0, 10);

  return {
    totalOrders,
    draftOrders,
    cancelledOrders,
    deliveredOrders,
    returnedOrders,
    grossRevenueMinor,
    pendingRevenueMinor,
    averageOrderValueMinor: totalOrders > 0 ? Math.round(placedTotalMinor / totalOrders) : 0,
    codOrders,
    onlineOrders,
    byStatus,
    bySource,
    dailySeries,
    topProducts,
  };
}

export interface CustomerAnalyticsRecord {
  segment?: string;
  consent?: { status?: string };
  createdAt?: unknown;
}

export function aggregateCustomers(
  customers: readonly CustomerAnalyticsRecord[],
  range: AnalyticsRange,
  now: Date,
): AnalyticsCustomerSummary {
  const cutoff = rangeCutoffDate(range, now);
  const bySegment = Object.fromEntries(CUSTOMER_SEGMENTS.map((s) => [s, 0])) as Record<
    CustomerSegment,
    number
  >;
  const consentBreakdown = { granted: 0, denied: 0, unknown: 0 };
  let newCustomersInRange = 0;

  for (const c of customers) {
    if (c.segment && c.segment in bySegment) {
      bySegment[c.segment as CustomerSegment] += 1;
    }
    const status = c.consent?.status;
    if (status === "granted") consentBreakdown.granted += 1;
    else if (status === "denied") consentBreakdown.denied += 1;
    else consentBreakdown.unknown += 1;

    const createdAt = toDateValue(c.createdAt);
    if (!cutoff || (createdAt && createdAt >= cutoff)) {
      newCustomersInRange += 1;
    }
  }

  return {
    totalCustomers: customers.length,
    newCustomersInRange,
    bySegment,
    consentBreakdown,
  };
}

export interface ConversationAnalyticsRecord {
  status?: string;
  channel?: string;
  unreadCount?: number;
}

export function aggregateInbox(
  conversations: readonly ConversationAnalyticsRecord[],
): AnalyticsInboxSummary {
  const byStatus = Object.fromEntries(CONVERSATION_STATUSES.map((s) => [s, 0])) as Record<
    ConversationStatus,
    number
  >;
  const byChannel = Object.fromEntries(CONVERSATION_CHANNELS.map((c) => [c, 0])) as Record<
    ConversationChannel,
    number
  >;
  let unreadConversations = 0;

  for (const conv of conversations) {
    if (conv.status && conv.status in byStatus) {
      byStatus[conv.status as ConversationStatus] += 1;
    }
    if (conv.channel && conv.channel in byChannel) {
      byChannel[conv.channel as ConversationChannel] += 1;
    }
    if (typeof conv.unreadCount === "number" && conv.unreadCount > 0) {
      unreadConversations += 1;
    }
  }

  return {
    totalConversations: conversations.length,
    unreadConversations,
    byStatus,
    byChannel,
  };
}

export interface VoiceCallAnalyticsRecord {
  status?: string;
  outcome?: string;
  durationSec?: number | null;
  createdAt?: unknown;
}

export interface AutomationRuleAnalyticsRecord {
  enabled?: boolean;
}

export interface AutomationRunAnalyticsRecord {
  status?: string;
  createdAt?: unknown;
}

export function aggregateOperations(
  voiceCalls: readonly VoiceCallAnalyticsRecord[],
  rules: readonly AutomationRuleAnalyticsRecord[],
  runs: readonly AutomationRunAnalyticsRecord[],
  range: AnalyticsRange,
  now: Date,
): AnalyticsOperationsSummary {
  const cutoff = rangeCutoffDate(range, now);

  let totalVoiceCalls = 0;
  let completedVoiceCalls = 0;
  let totalTalkDurationSec = 0;
  const voiceOutcomes: Record<string, number> = {};

  for (const call of voiceCalls) {
    const createdAt = toDateValue(call.createdAt);
    if (cutoff && (!createdAt || createdAt < cutoff)) continue;
    totalVoiceCalls += 1;
    if (call.status === "completed") completedVoiceCalls += 1;
    if (typeof call.durationSec === "number" && call.durationSec > 0) {
      totalTalkDurationSec += call.durationSec;
    }
    const outcome = call.outcome || "unknown";
    voiceOutcomes[outcome] = (voiceOutcomes[outcome] ?? 0) + 1;
  }

  const activeAutomationRules = rules.filter((r) => Boolean(r.enabled)).length;
  let automationRunsSucceeded = 0;
  let automationRunsSkipped = 0;
  let automationRunsFailed = 0;

  for (const run of runs) {
    const createdAt = toDateValue(run.createdAt);
    if (cutoff && (!createdAt || createdAt < cutoff)) continue;
    if (run.status === "succeeded") automationRunsSucceeded += 1;
    else if (run.status === "skipped") automationRunsSkipped += 1;
    else if (run.status === "failed") automationRunsFailed += 1;
  }

  return {
    totalVoiceCalls,
    completedVoiceCalls,
    totalTalkDurationSec,
    voiceOutcomes,
    activeAutomationRules,
    automationRunsSucceeded,
    automationRunsSkipped,
    automationRunsFailed,
  };
}

export interface ProductAnalyticsRecord {
  archived?: boolean;
}

export interface InventoryAnalyticsRecord {
  onHand?: number;
  reserved?: number;
  available?: number;
}

export function aggregateInventory(
  products: readonly ProductAnalyticsRecord[],
  inventory: readonly InventoryAnalyticsRecord[],
): AnalyticsInventorySummary {
  const activeProducts = products.filter((p) => !p.archived).length;
  let totalOnHand = 0;
  let totalReserved = 0;
  let totalAvailable = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;

  for (const row of inventory) {
    const onHand = typeof row.onHand === "number" ? row.onHand : 0;
    const reserved = typeof row.reserved === "number" ? row.reserved : 0;
    const available = typeof row.available === "number" ? row.available : 0;
    totalOnHand += onHand;
    totalReserved += reserved;
    totalAvailable += available;
    if (available <= 0) outOfStockCount += 1;
    else if (available <= LOW_STOCK_THRESHOLD) lowStockCount += 1;
  }

  return {
    activeProducts,
    totalSkus: inventory.length,
    totalOnHand,
    totalReserved,
    totalAvailable,
    lowStockCount,
    outOfStockCount,
  };
}

export async function getAnalyticsReport(
  organizationId: string,
  range: AnalyticsRange,
  now: Date = new Date(),
): Promise<AnalyticsReport> {
  if (!isValidIdSegment(organizationId)) {
    throw invalid("organizationId", "Invalid organization");
  }
  const db = adminDb();
  const byOrg = (col: string) => db.collection(col).where("organizationId", "==", organizationId).get();

  const [ordersSnap, customersSnap, convsSnap, callsSnap, rulesSnap, runsSnap, productsSnap, invSnap] =
    await Promise.all([
      byOrg(ORDERS),
      byOrg(CUSTOMERS),
      byOrg(CONVERSATIONS),
      byOrg(VOICE_CALLS),
      byOrg(AUTOMATION_RULES),
      byOrg(AUTOMATION_RUNS),
      byOrg(PRODUCTS),
      byOrg(INVENTORY),
    ]);

  return {
    range,
    generatedAt: now.toISOString(),
    sales: aggregateOrders(
      ordersSnap.docs.map((d) => d.data() as OrderAnalyticsRecord),
      range,
      now,
    ),
    customers: aggregateCustomers(
      customersSnap.docs.map((d) => d.data() as CustomerAnalyticsRecord),
      range,
      now,
    ),
    inbox: aggregateInbox(convsSnap.docs.map((d) => d.data() as ConversationAnalyticsRecord)),
    operations: aggregateOperations(
      callsSnap.docs.map((d) => d.data() as VoiceCallAnalyticsRecord),
      rulesSnap.docs.map((d) => d.data() as AutomationRuleAnalyticsRecord),
      runsSnap.docs.map((d) => d.data() as AutomationRunAnalyticsRecord),
      range,
      now,
    ),
    inventory: aggregateInventory(
      productsSnap.docs.map((d) => d.data() as ProductAnalyticsRecord),
      invSnap.docs.map((d) => d.data() as InventoryAnalyticsRecord),
    ),
  };
}
