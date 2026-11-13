/**
 * `confirm_order`: confirms the session's open draft once the customer explicitly agreed.
 * Server-only.
 *
 * `customerConfirmed` must be `true`, else `invalid` ("Ask the customer to confirm the summary
 * first."). The `confirmationQuote` (the customer's own words) goes into the order timeline as a
 * `note` event after the confirmation (control characters stripped, at most 200 characters); it
 * is never part of a failure message.
 *
 * LIVE. The draft is the session's open draft of the contact customer: none is `not_found`, an
 * only-expired one the hold-expired message. `confirmOrder` errors map to static messages. An
 * online order still confirms (to `awaiting_payment`) and returns `paymentLinkAvailable: false`
 * with a note, until payment links exist.
 *
 * IDEMPOTENT. With no open draft, when the session's newest AI order is already confirmed (or
 * later, not cancelled), the call returns that order's summary with `alreadyConfirmed: true`
 * and writes nothing (no second note event).
 *
 * TEST CHANNEL. A `confirm_order` dry run, without any lookup or write; its fields carry only the
 * quote's length, never the customer's words.
 */
import "server-only";

import { z } from "zod";

import { formatMoneyMinor } from "@/lib/format";
import { ORDER_STATUSES, PAYMENT_STATUSES, type Order } from "@/schemas/order";
import { confirmOrder } from "@/services/orders/lifecycle";
import { isOrderExpired } from "@/services/orders/queries";

import {
  CONTACT_DENIED,
  ORDER_MESSAGES,
  PREVIEW_ORDER_NUMBER,
  cleanConfirmationQuote,
  isConfirmedOrLater,
  contactCustomer,
  guarded,
  orderCtxOf,
  recordConfirmationQuote,
  sessionOrders,
} from "./order-access";
import { defineTool, isLiveChannel, toolFailure, type ToolContext, type ToolOutcome } from "./types";

const inputSchema = z.object({
  customerConfirmed: z
    .boolean()
    .describe("true only when the customer explicitly said yes to the summary you showed."),
  confirmationQuote: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("The customer's own words of confirmation, copied from their message."),
});
type ConfirmInput = z.output<typeof inputSchema>;

const outputSchema = z.object({
  orderNumber: z.string(),
  status: z.enum(ORDER_STATUSES),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  totalText: z.string().optional(),
  paymentLinkAvailable: z.boolean().optional(),
  alreadyConfirmed: z.boolean().optional(),
  note: z.string().optional(),
});
type ConfirmOutput = z.output<typeof outputSchema>;

function summaryOf(order: Order): ConfirmOutput {
  const data: ConfirmOutput = {
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    totalText: formatMoneyMinor(order.totalMinor),
  };
  if (order.paymentMethod === "online" && order.paymentStatus !== "paid") {
    data.paymentLinkAvailable = false;
    data.note = ORDER_MESSAGES.onlineNote;
  }
  return data;
}

async function run(ctx: ToolContext, input: ConfirmInput): Promise<ToolOutcome<ConfirmOutput>> {
  if (input.customerConfirmed !== true) {
    return toolFailure("invalid", ORDER_MESSAGES.confirmFirst);
  }
  if (!isLiveChannel(ctx.channel)) {
    return {
      ok: true,
      data: { orderNumber: PREVIEW_ORDER_NUMBER, status: "confirmed" },
      dryRunAction: {
        kind: "confirm_order",
        // Never the customer's words themselves (they are recorded only on a live order).
        fields: { quoteLength: cleanConfirmationQuote(input.confirmationQuote).length },
      },
    };
  }

  const customer = await contactCustomer(ctx);
  if (!customer) return toolFailure("denied", CONTACT_DENIED);
  const orders = await sessionOrders(ctx, customer.id);
  const drafts = orders.filter((o) => o.status === "draft");
  const draft = drafts.find((o) => !isOrderExpired(o));
  if (!draft) {
    // Idempotent: a repeated confirm of the session's newest order reports it again (no second
    // note event, no write).
    const newest = orders[0];
    if (newest && isConfirmedOrLater(newest)) {
      return { ok: true, data: { ...summaryOf(newest), alreadyConfirmed: true } };
    }
    return drafts.length > 0
      ? toolFailure("invalid", ORDER_MESSAGES.expired)
      : toolFailure("not_found", ORDER_MESSAGES.noDraftToConfirm);
  }

  return guarded("confirm", async () => {
    const order = await confirmOrder(orderCtxOf(ctx), draft.id);
    await recordConfirmationQuote(ctx, order.id, input.confirmationQuote);
    return { ok: true, data: summaryOf(order) };
  });
}

export const confirmOrderTool = defineTool<ConfirmInput, ConfirmOutput>({
  name: "confirm_order",
  description:
    "Confirm the open draft order of this conversation. Call it ONLY after you showed the full " +
    "summary (items, delivery charge, total, payment method) and the customer explicitly said " +
    "yes; set customerConfirmed to true and copy their words into confirmationQuote. Returns " +
    "the order number and status. For online payment it also says whether a payment link is " +
    "available.",
  input: inputSchema,
  output: outputSchema,
  writes: true,
  run,
});
