import "server-only";

import { z } from "zod";

import { formatMoneyMinor } from "@/lib/format";
import { isValidIdSegment } from "@/lib/ids";
import { orderNumberRef, orderRepo } from "@/repositories/orders";
import type { Order } from "@/schemas/order";
import { createPaymentLink } from "@/services/payments/links";

import {
  CONTACT_DENIED,
  PREVIEW_ORDER_NUMBER,
  contactCustomer,
} from "./order-access";
import { defineTool, isLiveChannel, toolFailure, type ToolContext, type ToolOutcome } from "./types";

const inputSchema = z.object({
  orderNumber: z
    .string()
    .trim()
    .min(1)
    .describe("The order number (e.g. SP-000123) to send a payment link for."),
});
type SendPaymentLinkInput = z.output<typeof inputSchema>;

const outputSchema = z.object({
  orderNumber: z.string(),
  url: z.string(),
  totalText: z.string(),
  expiresAt: z.string(),
});
type SendPaymentLinkOutput = z.output<typeof outputSchema>;

async function findOrderByNumber(orgId: string, orderNumber: string): Promise<Order | null> {
  try {
    const lock = await orderNumberRef(orgId, orderNumber).get();
    if (!lock.exists || lock.get("organizationId") !== orgId) return null;
    const orderId: unknown = lock.get("orderId");
    if (!isValidIdSegment(orderId)) return null;
    return orderRepo.get(orgId, orderId);
  } catch {
    return null;
  }
}

async function run(
  ctx: ToolContext,
  input: SendPaymentLinkInput,
): Promise<ToolOutcome<SendPaymentLinkOutput>> {
  if (!isLiveChannel(ctx.channel)) {
    return {
      ok: true,
      data: {
        orderNumber: input.orderNumber || PREVIEW_ORDER_NUMBER,
        url: "https://pay.example.com/pay/simulated_token",
        totalText: "৳1,500.00",
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      },
      dryRunAction: {
        kind: "send_payment_link",
        fields: { orderNumber: input.orderNumber },
      },
    };
  }

  const customer = await contactCustomer(ctx);
  if (!customer) return toolFailure("denied", CONTACT_DENIED);

  const order = await findOrderByNumber(ctx.organizationId, input.orderNumber);
  if (!order || order.customerId !== customer.id) {
    return toolFailure("not_found", "Order not found or does not belong to you.");
  }

  if (order.paymentMethod === "cod") {
    return toolFailure("invalid", "This order is Cash on Delivery and does not require an online payment link.");
  }

  if (order.paymentStatus === "paid" || order.paymentStatus === "cod_collected") {
    return toolFailure("invalid", "This order has already been paid.");
  }

  if (order.status !== "confirmed") {
    return toolFailure("invalid", `Cannot send a payment link for an order in ${order.status} status.`);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const link = await createPaymentLink(ctx.organizationId, order.id, appUrl);

  return {
    ok: true,
    data: {
      orderNumber: order.orderNumber,
      url: link.url,
      totalText: formatMoneyMinor(order.totalMinor),
      expiresAt: link.expiresAt.toISOString(),
    },
  };
}

export const sendPaymentLinkTool = defineTool<SendPaymentLinkInput, SendPaymentLinkOutput>({
  name: "send_payment_link",
  description:
    "Generate and send an online payment link for a confirmed, unpaid order. Call this when " +
    "the customer chose online payment or asks how to pay for their order.",
  input: inputSchema,
  output: outputSchema,
  writes: true,
  run,
});
