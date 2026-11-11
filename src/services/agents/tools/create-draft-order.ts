/**
 * `create_draft_order`: starts the conversing customer's draft order and holds its stock.
 * Server-only.
 *
 * LIVE (whatsapp / voice). The customer is the contact (see order-access.ts), never an argument;
 * the recipient phone is the contact's. Every line is checked against the agent's catalogue
 * scope first. Then:
 *   - the session already has an open draft -> it is updated instead (`updateDraftOrder`), or
 *     returned as-is when it already holds exactly these lines, address and payment method;
 *   - otherwise `createDraftOrder` (source "ai", discount 0) with the idempotency key
 *     `toolIdempotencyKey(ctx, args)`, so identical concurrent calls make one order. When that
 *     key's order is no longer an open draft of this customer (confirmed, cancelled, expired),
 *     the key is derived again from the args plus that order's id: a deterministic chain, so the
 *     customer can order the same items again after a hold expired.
 *
 * TEST CHANNEL. A dry run: the same checks (scope, unit, stock read-only), priced through
 * `priceOrder` with the organization's delivery charges; order number "DRAFT-PREVIEW" and a
 * `create_order` dryRunAction. Nothing is written: no order, reservation or event.
 */
import "server-only";

import { z } from "zod";

import { stableJson } from "@/lib/stable-json";
import type { CustomerDoc } from "@/repositories/customers";
import type { Order, PaymentMethod, ShippingAddress } from "@/schemas/order";
import { createDraftOrder, updateDraftOrder } from "@/services/orders/drafts";
import { isOrderExpired } from "@/services/orders/queries";
import { getOrderSettings } from "@/services/orders/settings";

import {
  CONTACT_DENIED,
  ORDER_MESSAGES,
  addressInputSchema,
  checkLines,
  contactCustomer,
  draftOutputSchema,
  draftSummary,
  guarded,
  linesInputSchema,
  openDraftFor,
  orderCtxOf,
  paymentMethodInputSchema,
  previewFields,
  previewSummary,
  shippingAddressOf,
  toolIdempotencyKey,
  type CheckedLine,
  type DraftOutput,
} from "./order-access";
import { defineTool, isLiveChannel, toolFailure, type ToolContext, type ToolOutcome } from "./types";

const inputSchema = z.object({
  lines: linesInputSchema.describe("The items: 1 to 20 lines of productId, variantId, quantity."),
  address: addressInputSchema,
  paymentMethod: paymentMethodInputSchema,
});
type CreateInput = z.output<typeof inputSchema>;

/** How many derived keys are tried when earlier orders of the same arguments have ended. */
const MAX_KEY_HOPS = 5;

const serviceLines = (
  lines: ReadonlyArray<{ productId: string; variantId: string; quantity: number }>,
) =>
  lines.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity }));

const addressKey = (a: Partial<ShippingAddress>) =>
  stableJson({
    recipientName: a.recipientName,
    line1: a.line1,
    area: a.area || undefined,
    district: a.district || undefined,
    zone: a.zone,
    phoneE164: a.phoneE164,
  });

/** True when the draft already holds exactly these lines, address and payment method. */
function draftMatches(
  draft: Order,
  lines: readonly CheckedLine[],
  address: ShippingAddress,
  paymentMethod: PaymentMethod,
): boolean {
  return (
    draft.paymentMethod === paymentMethod &&
    stableJson(serviceLines(draft.lines)) === stableJson(serviceLines(lines)) &&
    addressKey(draft.shippingAddress) === addressKey(address)
  );
}

const usable = (order: Order, customerId: string) =>
  order.status === "draft" && !isOrderExpired(order) && order.customerId === customerId;

async function createFresh(
  ctx: ToolContext,
  customer: CustomerDoc,
  input: CreateInput,
  lines: readonly CheckedLine[],
  shippingAddress: ShippingAddress,
): Promise<Order | null> {
  let after: string | undefined;
  for (let hop = 0; hop < MAX_KEY_HOPS; hop += 1) {
    const order = await createDraftOrder(orderCtxOf(ctx), {
      customerId: customer.id,
      lines: serviceLines(lines),
      shippingAddress,
      paymentMethod: input.paymentMethod,
      discountMinor: 0,
      idempotencyKey: toolIdempotencyKey(ctx, after === undefined ? input : { args: input, after }),
      source: "ai",
    });
    if (usable(order, customer.id)) return order;
    after = order.id;
  }
  return null;
}

async function preview(ctx: ToolContext, input: CreateInput): Promise<ToolOutcome<DraftOutput>> {
  const checked = await checkLines(ctx, input.lines);
  if (!checked.ok) return checked;
  const settings = await getOrderSettings(ctx.organizationId);
  return guarded("edit", async () => ({
    ok: true,
    data: previewSummary(checked.lines, input.address.zone, input.paymentMethod, settings),
    dryRunAction: {
      kind: "create_order",
      fields: previewFields(checked.lines, input.address, input.paymentMethod),
    },
  }));
}

async function run(ctx: ToolContext, input: CreateInput): Promise<ToolOutcome<DraftOutput>> {
  if (!isLiveChannel(ctx.channel)) return preview(ctx, input);

  const customer = await contactCustomer(ctx);
  if (!customer) return toolFailure("denied", CONTACT_DENIED);
  const checked = await checkLines(ctx, input.lines);
  if (!checked.ok) return checked;
  const shippingAddress = shippingAddressOf(input.address, customer.phoneE164);
  if (!shippingAddress) return toolFailure("invalid", ORDER_MESSAGES.badAddress);

  return guarded("edit", async () => {
    const draft = await openDraftFor(ctx, customer.id);
    if (draft) {
      if (draftMatches(draft, checked.lines, shippingAddress, input.paymentMethod)) {
        return { ok: true, data: draftSummary(draft) };
      }
      const updated = await updateDraftOrder(orderCtxOf(ctx), draft.id, {
        lines: serviceLines(checked.lines),
        shippingAddress,
        paymentMethod: input.paymentMethod,
      });
      return { ok: true, data: draftSummary(updated) };
    }
    const order = await createFresh(ctx, customer, input, checked.lines, shippingAddress);
    if (!order) return toolFailure("failed", ORDER_MESSAGES.busy);
    return { ok: true, data: draftSummary(order) };
  });
}

export const createDraftOrderTool = defineTool<CreateInput, DraftOutput>({
  name: "create_draft_order",
  description:
    "Create a draft order for the customer in this conversation once you know the items, the " +
    "delivery address (with zone inside_dhaka or outside_dhaka) and the payment method (cod or " +
    "online). It checks stock, holds it and returns the order number, line totals, delivery " +
    "charge, total and how many minutes the stock is held. If this conversation already has an " +
    "open draft, it is updated instead. The order is not confirmed yet: show the customer the " +
    "full summary and use confirm_order only after they say yes. The customer must already be " +
    "saved with save_customer_info.",
  input: inputSchema,
  output: draftOutputSchema,
  writes: true,
  run,
});
