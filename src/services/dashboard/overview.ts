/**
 * Dashboard overview counts. Server-only.
 *
 * Four independent Firestore `count()` aggregations, run in parallel. Each settles on its own: a
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
 */
import "server-only";

import type { Query } from "firebase-admin/firestore";

import { LOW_STOCK_THRESHOLD } from "@/config/inventory";
import { adminDb } from "@/lib/firebase/admin";
import { isValidIdSegment } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { invalid } from "@/lib/validation-error";
import { CUSTOMERS } from "@/repositories/customers";
import { INVENTORY, PRODUCTS } from "@/repositories/products";
import type { WhereClause } from "@/repositories/base";

import { LEAD_SEGMENTS } from "./lead-segments";

export { LEAD_SEGMENTS };

export const METRICS = ["customers", "leads", "products", "lowStock"] as const;
export type MetricName = (typeof METRICS)[number];

export type Metric = { ok: true; value: number } | { ok: false };
export type Overview = Record<MetricName, Metric>;

export interface MetricQuery {
  collection: string;
  where: WhereClause[];
}

/** The query behind each metric, as data (so tests can pin the shapes without Firestore). */
export function metricQueries(orgId: string): Record<MetricName, MetricQuery> {
  const scope: WhereClause = ["organizationId", "==", orgId];
  return {
    customers: { collection: CUSTOMERS, where: [scope] },
    leads: { collection: CUSTOMERS, where: [scope, ["segment", "in", [...LEAD_SEGMENTS]]] },
    products: { collection: PRODUCTS, where: [scope, ["archived", "==", false]] },
    lowStock: { collection: INVENTORY, where: [scope, ["available", "<=", LOW_STOCK_THRESHOLD]] },
  };
}

export interface OverviewOptions {
  /** Test seam: executes one metric's aggregation. Defaults to a Firestore `count()`. */
  runCount?: (metric: MetricName, query: Query) => Promise<number>;
}

const defaultRunCount = async (_metric: MetricName, query: Query): Promise<number> =>
  (await query.count().get()).data().count;

function errorCode(err: unknown): string | number | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" || typeof code === "number" ? code : undefined;
}

export async function getOverview(orgId: string, options: OverviewOptions = {}): Promise<Overview> {
  if (!isValidIdSegment(orgId)) throw invalid("organizationId", "Invalid organization");
  const runCount = options.runCount ?? defaultRunCount;
  const db = adminDb();
  const queries = metricQueries(orgId);

  const settled = await Promise.allSettled(
    METRICS.map((metric) => {
      const { collection, where } = queries[metric];
      const query = where.reduce<Query>((q, [field, op, value]) => q.where(field, op, value), db.collection(collection));
      return runCount(metric, query);
    }),
  );

  const result = {} as Overview;
  METRICS.forEach((metric, i) => {
    const outcome = settled[i]!;
    if (outcome.status === "fulfilled" && Number.isSafeInteger(outcome.value) && outcome.value >= 0) {
      result[metric] = { ok: true, value: outcome.value };
      return;
    }
    // Name and code only: an error message could echo query details.
    logger.error("dashboard overview metric failed", {
      metric,
      organizationId: orgId,
      errorName: outcome.status === "rejected" ? (outcome.reason as Error | undefined)?.name : "InvalidCount",
      errorCode: outcome.status === "rejected" ? errorCode(outcome.reason) : undefined,
    });
    result[metric] = { ok: false };
  });
  return result;
}
