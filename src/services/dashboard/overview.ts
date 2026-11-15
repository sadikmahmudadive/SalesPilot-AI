/**
 * Dashboard overview figures. Server-only.
 *
 * Six independent Firestore aggregations (four counts, an orders-today count and a revenue sum),
 * run in parallel. Each settles on its own: a
 * failure becomes `{ ok: false }` for that metric only (and is logged by metric name), so the page
 * can show "Couldn't load" on one card while the others keep their numbers. Aggregations read no
 * documents, so nothing about a customer or product leaves Firestore.
 *
 * Queries (all scoped by `organizationId == orgId`):
 *   customers  organizationId ==
 *   leads      organizationId == AND segment in LEAD_SEGMENTS
 *   products   organizationId == AND archived == false
 *   lowStock   organizationId == AND available <= LOW_STOCK_THRESHOLD
 * INDEXES: the first three are equality-only (the `in` is a disjunction of equalities), served by
 * Firestore's automatic single-field indexes (merged). lowStock is a range and uses the existing
 * inventory entry [organizationId ASC, available ASC, __name__ ASC] (see inventory-indexes.ts).
 * The emulator does not enforce indexes, so overview.test.ts asserts the lowStock entry exists.
 *
 * Order metrics (Asia/Dhaka boundaries from dhaka-time.ts). A `not-in` cannot be combined with a
 * range on another field cheaply, so each is the sum of one query per wanted value:
 *   ordersToday        per status in COUNTED_ORDER_STATUSES (everything but draft and cancelled):
 *                      organizationId == AND status == AND createdAt >= start of today (count)
 *   revenueMonthMinor  per paymentStatus in REVENUE_PAYMENT_STATUSES:
 *                      organizationId == AND paymentStatus == AND createdAt >= start of month
 *                      (sum of totalMinor)
 * INDEXES: the counts are served by the existing orders entries [organizationId, status, createdAt]
 * and [organizationId, paymentStatus, createdAt]. The sum reads totalMinor from the index, so it
 * has its own entry [organizationId, paymentStatus, createdAt, totalMinor] (see order-indexes.ts).
 * overview.test.ts asserts all three; the emulator does not enforce any of them.
 * Revenue is by creation date, not collection date: an order created last month and paid today is
 * not in this month's figure.
 */
import "server-only";

import { AggregateField, type Query } from "firebase-admin/firestore";

import { LOW_STOCK_THRESHOLD } from "@/config/inventory";
import { adminDb } from "@/lib/firebase/admin";
import { isValidIdSegment } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { invalid } from "@/lib/validation-error";
import { CUSTOMERS } from "@/repositories/customers";
import { CONVERSATIONS } from "@/repositories/conversations";
import { INVENTORY, PRODUCTS } from "@/repositories/products";
import type { WhereClause } from "@/repositories/base";
import { ORDERS } from "@/repositories/orders";
import { VOICE_CALLS } from "@/repositories/voice";
import { ORDER_STATUSES, type OrderStatus, type PaymentStatus } from "@/schemas/order";

import { dhakaDayStart, dhakaMonthStart } from "./dhaka-time";
import { LEAD_SEGMENTS } from "./lead-segments";

export { LEAD_SEGMENTS };

export const METRICS = [
  "customers",
  "leads",
  "products",
  "lowStock",
  "ordersToday",
  "revenueMonthMinor",
] as const;
export type MetricName = (typeof METRICS)[number];

/** Metrics that are one `count()` over a single query. */
type SimpleMetricName = "customers" | "leads" | "products" | "lowStock";

/** Orders that count as placed: everything except drafts (not yet an order) and cancelled ones. */
export const COUNTED_ORDER_STATUSES = ORDER_STATUSES.filter(
  (s): s is Exclude<OrderStatus, "draft" | "cancelled"> => s !== "draft" && s !== "cancelled",
);
/** Payment statuses whose money has actually been received. */
export const REVENUE_PAYMENT_STATUSES = [
  "paid",
  "cod_collected",
] as const satisfies readonly PaymentStatus[];

export type Metric = { ok: true; value: number } | { ok: false };
export type Overview = Record<MetricName, Metric>;

export interface MetricQuery {
  collection: string;
  where: WhereClause[];
}

/** The query behind each metric, as data (so tests can pin the shapes without Firestore). */
export function metricQueries(orgId: string): Record<SimpleMetricName, MetricQuery> {
  const scope: WhereClause = ["organizationId", "==", orgId];
  return {
    customers: { collection: CUSTOMERS, where: [scope] },
    leads: { collection: CUSTOMERS, where: [scope, ["segment", "in", [...LEAD_SEGMENTS]]] },
    products: { collection: PRODUCTS, where: [scope, ["archived", "==", false]] },
    lowStock: { collection: INVENTORY, where: [scope, ["available", "<=", LOW_STOCK_THRESHOLD]] },
  };
}

/**
 * The queries behind the order metrics; each metric is the SUM over its list (see the header).
 * `now` decides the Dhaka day and month.
 */
export function orderMetricQueries(
  orgId: string,
  now: Date,
): { ordersToday: MetricQuery[]; revenueMonth: MetricQuery[] } {
  const scope: WhereClause = ["organizationId", "==", orgId];
  const dayStart = dhakaDayStart(now);
  const monthStart = dhakaMonthStart(now);
  return {
    ordersToday: COUNTED_ORDER_STATUSES.map((status) => ({
      collection: ORDERS,
      where: [scope, ["status", "==", status], ["createdAt", ">=", dayStart]],
    })),
    revenueMonth: REVENUE_PAYMENT_STATUSES.map((paymentStatus) => ({
      collection: ORDERS,
      where: [scope, ["paymentStatus", "==", paymentStatus], ["createdAt", ">=", monthStart]],
    })),
  };
}

export interface OverviewOptions {
  /** Test seam: executes one count aggregation. Defaults to a Firestore `count()`. */
  runCount?: (metric: MetricName, query: Query) => Promise<number>;
  /** Test seam: executes one `sum(totalMinor)` aggregation. Defaults to a Firestore sum. */
  runSum?: (metric: MetricName, query: Query) => Promise<number>;
  /** Test seam: the clock that decides the Dhaka day and month. */
  now?: () => Date;
}

const defaultRunCount = async (_metric: MetricName, query: Query): Promise<number> =>
  (await query.count().get()).data().count;

const defaultRunSum = async (_metric: MetricName, query: Query): Promise<number> =>
  (await query.aggregate({ total: AggregateField.sum("totalMinor") }).get()).data().total;

const toQuery = (db: ReturnType<typeof adminDb>, { collection, where }: MetricQuery): Query =>
  where.reduce<Query>(
    (q, [field, op, value]) => q.where(field, op, value),
    db.collection(collection),
  );

const sum = (parts: number[]): number => parts.reduce((a, b) => a + b, 0);

function errorCode(err: unknown): string | number | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" || typeof code === "number" ? code : undefined;
}

export async function getOverview(orgId: string, options: OverviewOptions = {}): Promise<Overview> {
  if (!isValidIdSegment(orgId)) throw invalid("organizationId", "Invalid organization");
  const runCount = options.runCount ?? defaultRunCount;
  const runSum = options.runSum ?? defaultRunSum;
  const db = adminDb();
  const queries = metricQueries(orgId);
  const orders = orderMetricQueries(orgId, (options.now ?? (() => new Date()))());

  const runners: Record<MetricName, () => Promise<number>> = {
    customers: () => runCount("customers", toQuery(db, queries.customers)),
    leads: () => runCount("leads", toQuery(db, queries.leads)),
    products: () => runCount("products", toQuery(db, queries.products)),
    lowStock: () => runCount("lowStock", toQuery(db, queries.lowStock)),
    ordersToday: async () =>
      sum(
        await Promise.all(orders.ordersToday.map((q) => runCount("ordersToday", toQuery(db, q)))),
      ),
    revenueMonthMinor: async () =>
      sum(
        await Promise.all(
          orders.revenueMonth.map((q) => runSum("revenueMonthMinor", toQuery(db, q))),
        ),
      ),
  };

  const settled = await Promise.allSettled(METRICS.map((metric) => runners[metric]()));

  const result = {} as Overview;
  METRICS.forEach((metric, i) => {
    const outcome = settled[i]!;
    if (
      outcome.status === "fulfilled" &&
      Number.isSafeInteger(outcome.value) &&
      outcome.value >= 0
    ) {
      result[metric] = { ok: true, value: outcome.value };
      return;
    }
    // Name and code only: an error message could echo query details.
    logger.error("dashboard overview metric failed", {
      metric,
      organizationId: orgId,
      errorName:
        outcome.status === "rejected"
          ? (outcome.reason as Error | undefined)?.name
          : "InvalidCount",
      errorCode: outcome.status === "rejected" ? errorCode(outcome.reason) : undefined,
    });
    result[metric] = { ok: false };
  });
  return result;
}

export const ACTIVITY_METRICS = ["conversations", "voiceCalls"] as const;
export type ActivityMetricName = (typeof ACTIVITY_METRICS)[number];
export type ActivityOverview = Record<ActivityMetricName, Metric>;

export function activityMetricQueries(orgId: string): Record<ActivityMetricName, MetricQuery> {
  const scope: WhereClause = ["organizationId", "==", orgId];
  return {
    conversations: { collection: CONVERSATIONS, where: [scope] },
    voiceCalls: { collection: VOICE_CALLS, where: [scope] },
  };
}

export async function getActivityOverview(
  orgId: string,
  options: { runCount?: (metric: ActivityMetricName, query: Query) => Promise<number> } = {},
): Promise<ActivityOverview> {
  if (!isValidIdSegment(orgId)) throw invalid("organizationId", "Invalid organization");
  const runCount =
    options.runCount ?? (async (_metric, query) => (await query.count().get()).data().count);
  const db = adminDb();
  const queries = activityMetricQueries(orgId);

  const settled = await Promise.allSettled(
    ACTIVITY_METRICS.map((metric) => runCount(metric, toQuery(db, queries[metric]))),
  );

  const result = {} as ActivityOverview;
  ACTIVITY_METRICS.forEach((metric, i) => {
    const outcome = settled[i]!;
    if (
      outcome.status === "fulfilled" &&
      Number.isSafeInteger(outcome.value) &&
      outcome.value >= 0
    ) {
      result[metric] = { ok: true, value: outcome.value };
      return;
    }
    logger.error("dashboard activity metric failed", {
      metric,
      organizationId: orgId,
      errorName:
        outcome.status === "rejected"
          ? (outcome.reason as Error | undefined)?.name
          : "InvalidCount",
      errorCode: outcome.status === "rejected" ? errorCode(outcome.reason) : undefined,
    });
    result[metric] = { ok: false };
  });
  return result;
}
