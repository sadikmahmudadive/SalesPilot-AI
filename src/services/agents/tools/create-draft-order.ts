/**
 * `create_draft_order`: starts the conversing customer's draft order and holds its stock.
 * Server-only.
 *
 * LIVE (whatsapp / voice). The customer is the contact (see order-access.ts), never an argument;
 * the recipient phone is the contact's. Every line is checked against the agent's catalogue
 * scope first. Then:
 *   - the session already has an open draft -> returned as-is when it already holds exactly
 *     these lines, address and payment method (checked BEFORE the stock pass, so its own hold
 *     never blocks a retry), else updated (`updateDraftOrder`; the lines only when they changed,
 *     and the stock pre-check credits the draft's own held quantities);
 *   - otherwise `createDraftOrder` (source "ai", discount 0) with the idempotency key
 *     `toolIdempotencyKey(ctx, args)`, so identical concurrent calls make one order. When that
 *     key's order was cancelled or is an expired draft, the key is derived again from the args
 *     plus that order's id (a deterministic chain, at most 5 keys), so the same items can be
 *     ordered again after a hold expired. A key whose order is confirmed or later is
 *     "This order is already confirmed." and nothing is created (Ruling R16).
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
  isConfirmedOrLater,
  linesInputSchema,
  openDraftFor,
  orderCtxOf,
  paymentMethodInputSchema,
  previewFields,
  previewSummary,
  sameLines,
  shippingAddressOf,
  toolIdempotencyKey,
  type CheckedLine,
  type LineInput,
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
  lines: readonly LineInput[],
  address: ShippingAddress,
  paymentMethod: PaymentMethod,
): boolean {
  return (
    draft.paymentMethod === paymentMethod &&
    sameLines(draft.lines, lines) &&
    addressKey(draft.shippingAddress) === addressKey(address)
  );
}

type Fresh =
  | { kind: "created"; order: Order }
  | { kind: "confirmed" }
  | { kind: "exhausted" }
  | { kind: "foreign" };

/**
 * `createDraftOrder` with the tool key. A replay that returns a cancelled order or an expired
 * draft hops to the key derived from the args plus that order's id (deterministic, so concurrent
 * identical calls still meet on one order). A replay of an order that is confirmed or later is
 * never hopped over: the customer already placed exactly this order (Ruling R16).
 */
async function createFresh(
  ctx: ToolContext,
  customer: CustomerDoc,
  input: CreateInput,
  lines: readonly CheckedLine[],
  shippingAddress: ShippingAddress,
): Promise<Fresh> {
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
    if (order.customerId !== customer.id) return { kind: "foreign" };
    if (isConfirmedOrLater(order)) return { kind: "confirmed" };
    const ended = order.status === "cancelled" || isOrderExpired(order);
    if (!ended) return { kind: "created", order };
    after = order.id;
  }
  return { kind: "exhausted" };
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
  const shippingAddress = shippingAddressOf(input.address, customer.phoneE164);
  if (!shippingAddress) return toolFailure("invalid", ORDER_MESSAGES.badAddress);

  return guarded("edit", async () => {
    const draft = await openDraftFor(ctx, customer.id);
    // An identical retry returns the draft before any stock check: its own hold must not block it.
    if (draft && draftMatches(draft, input.lines, shippingAddress, input.paymentMethod)) {
      return { ok: true, data: draftSummary(draft) };
    }
    // The open draft's held stock is credited to its own edit.
    const checked = await checkLines(ctx, input.lines, draft?.lines);
    if (!checked.ok) return checked;

    if (draft) {
      // Unchanged lines are not re-reserved (an address or payment change needs no extra stock).
      const linesChanged = !sameLines(draft.lines, input.lines);
      const updated = await updateDraftOrder(orderCtxOf(ctx), draft.id, {
        ...(linesChanged ? { lines: serviceLines(checked.lines) } : {}),
        shippingAddress,
        paymentMethod: input.paymentMethod,
      });
      return { ok: true, data: draftSummary(updated) };
    }

    const fresh = await createFresh(ctx, customer, input, checked.lines, shippingAddress);
    switch (fresh.kind) {
      case "created":
        return { ok: true, data: draftSummary(fresh.order) };
      case "confirmed":
        return toolFailure("invalid", ORDER_MESSAGES.alreadyConfirmed);
      case "exhausted":
        return toolFailure("failed", ORDER_MESSAGES.cannotRecreate);
      case "foreign":
        return toolFailure("failed");
    }
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
