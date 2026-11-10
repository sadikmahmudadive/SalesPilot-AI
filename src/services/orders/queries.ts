/**
 * Order reads. Server-only.
 *
 * Every read is scoped to `ctx.organizationId`: an invalid id, a missing order and another
 * organization's order are the same `NotFoundError`.
 *
 * `listOrders` (newest first, cursor pagination) supports:
 *   - no filter, or EXACTLY ONE equality filter among `status`, `paymentStatus`, `customerId`
 *     and a phone `q` (`customerSnapshot.phoneE164 ==`, after `normalizePhone`);
 *   - optionally combined with a `from` / `to` range on `createdAt` (inclusive).
 * Each shape is served by an `ORDER_INDEXES` entry (organizationId [, filter], createdAt DESC);
 * a combination without one (two equality filters) is a `ValidationError`, never a new index.
 * A `q` of the form `SP-<digits>` (any case) is an order-number lookup through the
 * `orderNumbers` lock (a direct get, no query): a page of at most one order of this organization,
 * with the other filters applied in memory and no cursor. Any other `q` that is not a phone is a
 * `ValidationError` on `q`.
 *
 * `listOrderEvents` is ascending only (the only index) and returns at most 200 events.
 */
import "server-only";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { isValidIdSegment } from "@/lib/ids";
import { assertEntityId, assertOrgCtx } from "@/lib/org-context";
import { normalizePhone } from "@/lib/phone";
import { invalid } from "@/lib/validation-error";
import type { WhereClause } from "@/repositories/base";
import { orderEventRepo, orderNumberRef, orderRepo } from "@/repositories/orders";
import {
  orderListQuerySchema,
  type Order,
  type OrderEvent,
  type OrderListQuery,
} from "@/schemas/order";

import { ORDER_INDEXES } from "./order-indexes";
import type { OrderCtx } from "./settings";

const SERVICE = "Orders";
const ORDER_NUMBER = /^SP-\d+$/i;
const MAX_EVENTS = 200;
const EVENTS_PAGE = 100;
const MAX_CUSTOMER_ORDERS = 50;

/**
 * True for an order whose hold has run out but that the sweep has not cancelled yet: a draft, or
 * a confirmed order still awaiting payment (`awaiting_payment` / `failed`), with `holdExpiresAt`
 * at or before `now` (the sweep's own `holdExpiresAt <= now`).
 */
export function isOrderExpired(
  order: Pick<Order, "status" | "paymentStatus" | "holdExpiresAt">,
  now = Date.now(),
): boolean {
  const holds =
    order.status === "draft" ||
    (order.status === "confirmed" &&
      (order.paymentStatus === "awaiting_payment" || order.paymentStatus === "failed"));
  return holds && order.holdExpiresAt !== null && Date.parse(order.holdExpiresAt) <= now;
}

export async function getOrder(
  ctx: OrderCtx,
  orderId: string,
): Promise<Order & { expired: boolean }> {
  assertOrgCtx(ctx, SERVICE);
  assertEntityId(orderId);
  const order = await orderRepo.get(ctx.organizationId, orderId);
  if (!order) throw new NotFoundError();
  return { ...order, expired: isOrderExpired(order) };
}

/** True when ORDER_INDEXES serves `organizationId [== , field ==] ORDER BY createdAt DESC`. */
function hasListIndex(field: string | undefined): boolean {
  const fields = field ? ["organizationId", field] : ["organizationId"];
  return ORDER_INDEXES.some(
    (s) =>
      s.collectionGroup === "orders" &&
      !s.crossOrg &&
      s.orderField === "createdAt" &&
      s.direction === "DESCENDING" &&
      s.equalityFields.length === fields.length &&
      s.equalityFields.every((f, i) => f === fields[i]),
  );
}

function parseListQuery(q: OrderListQuery): OrderListQuery {
  const parsed = orderListQuerySchema.safeParse(q ?? {});
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => ({ path: i.path.join(".") || "query", message: i.message })),
    );
  }
  return parsed.data;
}

/** The in-memory form of the non-`q` filters, for an order-number match. */
function matches(order: Order, q: OrderListQuery, from: number | null, to: number | null) {
  const created = Date.parse(order.createdAt);
  return (
    (q.status === undefined || order.status === q.status) &&
    (q.paymentStatus === undefined || order.paymentStatus === q.paymentStatus) &&
    (q.customerId === undefined || order.customerId === q.customerId) &&
    (from === null || created >= from) &&
    (to === null || created <= to)
  );
}

async function findByNumber(orgId: string, orderNumber: string): Promise<Order | null> {
  const lock = await orderNumberRef(orgId, orderNumber).get();
  if (!lock.exists || lock.get("organizationId") !== orgId) return null;
  const orderId: unknown = lock.get("orderId");
  if (!isValidIdSegment(orderId)) return null;
  return orderRepo.get(orgId, orderId);
}

export async function listOrders(
  ctx: OrderCtx,
  input: OrderListQuery,
): Promise<{ items: Order[]; nextCursor: string | null }> {
  assertOrgCtx(ctx, SERVICE);
  const orgId = ctx.organizationId;
  const q = parseListQuery(input);
  const from = q.from === undefined ? null : Date.parse(q.from);
  const to = q.to === undefined ? null : Date.parse(q.to);
  if (from !== null && to !== null && from > to) {
    throw invalid("to", "Choose an end on or after the start");
  }

  const equality: WhereClause[] = [];
  if (q.q !== undefined) {
    if (ORDER_NUMBER.test(q.q)) {
      const order = await findByNumber(orgId, q.q.toUpperCase());
      return { items: order && matches(order, q, from, to) ? [order] : [], nextCursor: null };
    }
    const phone = normalizePhone(q.q);
    if (!phone) throw invalid("q", "Enter an order number (SP-000123) or a phone number");
    equality.push(["customerSnapshot.phoneE164", "==", phone]);
  }
  if (q.status !== undefined) equality.push(["status", "==", q.status]);
  if (q.paymentStatus !== undefined) equality.push(["paymentStatus", "==", q.paymentStatus]);
  if (q.customerId !== undefined) equality.push(["customerId", "==", q.customerId]);

  if (equality.length > 1 || !hasListIndex(equality[0]?.[0])) {
    throw invalid("filter", "Use only one filter at a time");
  }

  const range: WhereClause[] = [];
  if (from !== null) range.push(["createdAt", ">=", new Date(from)]);
  if (to !== null) range.push(["createdAt", "<=", new Date(to)]);

  return orderRepo.list(orgId, {
    where: [...equality, ...range],
    orderBy: ["createdAt", "desc"],
    limit: q.limit,
    cursor: q.cursor,
  });
}

/** The order's timeline, oldest first, at most 200 events. */
export async function listOrderEvents(ctx: OrderCtx, orderId: string): Promise<OrderEvent[]> {
  assertOrgCtx(ctx, SERVICE);
  assertEntityId(orderId);
  const orgId = ctx.organizationId;
  if (!(await orderRepo.get(orgId, orderId))) throw new NotFoundError();

  const out: OrderEvent[] = [];
  let cursor: string | undefined;
  do {
    const page = await orderEventRepo.list(orgId, {
      where: [["orderId", "==", orderId]],
      orderBy: ["createdAt", "asc"],
      limit: Math.min(EVENTS_PAGE, MAX_EVENTS - out.length),
      cursor,
    });
    out.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined && out.length < MAX_EVENTS);
  return out;
}

/** A customer's latest orders, newest first (default 5, at most 50). */
export async function listCustomerOrders(
  ctx: OrderCtx,
  customerId: string,
  limit = 5,
): Promise<Order[]> {
  assertOrgCtx(ctx, SERVICE);
  assertEntityId(customerId);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CUSTOMER_ORDERS) {
    throw invalid("limit", `Use a limit from 1 to ${MAX_CUSTOMER_ORDERS}`);
  }
  const page = await orderRepo.list(ctx.organizationId, {
    where: [["customerId", "==", customerId]],
    orderBy: ["createdAt", "desc"],
    limit,
  });
  return page.items;
}
