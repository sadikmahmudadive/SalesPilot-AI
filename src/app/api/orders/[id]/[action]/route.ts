/**
 * POST /api/orders/[id]/[action]  -> 200 Order
 *
 *   action   body                                  effect
 *   confirm  none                                  draft -> confirmed
 *   process  { allowUnpaidReason? } (optional)     confirmed -> processing (reason needed for unpaid online)
 *   ship     none                                  processing -> shipped (commits stock)
 *   deliver  none                                  shipped -> delivered
 *   return   none                                  delivered -> returned
 *   cancel   { reason }                            cancels and releases stock
 *   refund   { reason }                            records a manual refund of a paid order
 *
 * Every action shares the `orders.action` rate limit (60 per minute per user). An unknown action
 * is a 404 (after the authentication, membership and permission checks); an unknown, invalid or
 * another organization's order id is also a 404. Body-less actions still pass the same-origin
 * check `withApi` applies to every mutation. Errors: 400, 401, 403, 404, 409, 415, 429.
 */
import type { ZodType } from "zod";

import { withApi, type RouteHandler } from "@/lib/api/handler";
import { NotFoundError } from "@/lib/errors";
import { processSchema, reasonSchema } from "@/schemas/order";
import {
  cancelOrder,
  confirmOrder,
  markDelivered,
  markReturned,
  markShipped,
  recordManualRefund,
  startProcessing,
} from "@/services/orders/lifecycle";
import type { OrderCtx } from "@/services/orders/settings";

interface ActionSpec {
  /** Body schema; omitted for actions that take no body. */
  schema?: ZodType;
  run: (ctx: OrderCtx, id: string, body: never) => Promise<object>;
}

function spec<B>(
  schema: ZodType<B> | undefined,
  run: (ctx: OrderCtx, id: string, body: B) => Promise<object>,
): ActionSpec {
  return { schema, run };
}

const ACTIONS: Record<string, ActionSpec> = {
  confirm: spec(undefined, (ctx, id) => confirmOrder(ctx, id)),
  process: spec(processSchema, (ctx, id, body) => startProcessing(ctx, id, body)),
  ship: spec(undefined, (ctx, id) => markShipped(ctx, id)),
  deliver: spec(undefined, (ctx, id) => markDelivered(ctx, id)),
  return: spec(undefined, (ctx, id) => markReturned(ctx, id)),
  cancel: spec(reasonSchema, (ctx, id, body) => cancelOrder(ctx, id, body.reason)),
  refund: spec(reasonSchema, (ctx, id, body) => recordManualRefund(ctx, id, body.reason)),
};

const RATE_LIMIT = { name: "orders.action", limit: 60, windowSec: 60 };

/** One `withApi` handler per action, so each gets its own body schema and the full pipeline. */
const HANDLERS = new Map<string, RouteHandler>(
  Object.entries(ACTIONS).map(([name, { schema, run }]) => [
    name,
    withApi(
      { permission: "orders:write", schema, rateLimit: RATE_LIMIT },
      async ({ params, body, organizationId, uid }) =>
        run({ organizationId, uid }, params.id ?? "", body as never),
    ),
  ]),
);

/** Runs the same auth pipeline, then reports the unknown action. */
const UNKNOWN_ACTION = withApi({ permission: "orders:write" }, async () => {
  throw new NotFoundError();
});

export const POST: RouteHandler = async (req, routeCtx) => {
  const action = (await routeCtx?.params)?.action ?? "";
  return (HANDLERS.get(action) ?? UNKNOWN_ACTION)(req, routeCtx);
};
