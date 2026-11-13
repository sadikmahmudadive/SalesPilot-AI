/**
 * `get_my_order_status`: the conversing customer's own latest orders. Server-only, read-only.
 *
 * LIVE. The customer is the contact (see order-access.ts); without one the call is `denied`.
 * Returns at most 5 orders, newest first, with number, status, payment status, total and
 * creation time; `expired: true` marks a hold that ran out before the sweep cancelled it. Nothing
 * about any other customer is ever read.
 *
 * TEST CHANNEL. There is no contact: `{ orders: [] }`.
 */
import "server-only";

import { z } from "zod";

import { formatMoneyMinor } from "@/lib/format";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "@/schemas/order";
import { isOrderExpired, listCustomerOrders } from "@/services/orders/queries";

import { CONTACT_DENIED, contactCustomer, orderCtxOf } from "./order-access";
import { defineTool, isLiveChannel, toolFailure, type ToolContext, type ToolOutcome } from "./types";

const MAX_ORDERS = 5;

const inputSchema = z.object({});
type StatusInput = z.output<typeof inputSchema>;

const outputSchema = z.object({
  orders: z.array(
    z.object({
      orderNumber: z.string(),
      status: z.enum(ORDER_STATUSES),
      paymentStatus: z.enum(PAYMENT_STATUSES),
      totalText: z.string(),
      createdAt: z.string(),
      expired: z.boolean().optional(),
      courierName: z.string().optional(),
      trackingCode: z.string().optional(),
      trackingUrl: z.string().optional(),
      courierStatus: z.string().optional(),
    }),
  ),
});
type StatusOutput = z.output<typeof outputSchema>;

async function run(ctx: ToolContext): Promise<ToolOutcome<StatusOutput>> {
  if (!isLiveChannel(ctx.channel)) return { ok: true, data: { orders: [] } };
  const customer = await contactCustomer(ctx);
  if (!customer) return toolFailure("denied", CONTACT_DENIED);
  const orders = await listCustomerOrders(orderCtxOf(ctx), customer.id, MAX_ORDERS);
  return {
    ok: true,
    data: {
      orders: orders.map((o) => ({
        orderNumber: o.orderNumber,
        status: o.status,
        paymentStatus: o.paymentStatus,
        totalText: formatMoneyMinor(o.totalMinor),
        createdAt: o.createdAt,
        ...(isOrderExpired(o) ? { expired: true } : {}),
        ...(o.shipment?.bookingState === "booked"
          ? {
              courierName: o.shipment.provider.toUpperCase(),
              trackingCode: o.shipment.trackingCode ?? undefined,
              trackingUrl: o.shipment.trackingUrl ?? undefined,
              courierStatus: o.shipment.status,
            }
          : {}),
      })),
    },
  };
}

export const orderStatusTool = defineTool<StatusInput, StatusOutput>({
  name: "get_my_order_status",
  description:
    "List the latest orders (up to 5) of the customer in this conversation: order number, " +
    "status, payment status, total and when it was placed. It never shows other customers' " +
    "orders. expired: true means the stock hold ran out and the order will be cancelled.",
  input: inputSchema,
  output: outputSchema,
  writes: false,
  run,
});
