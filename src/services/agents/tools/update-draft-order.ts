/**
 * `update_draft_order`: changes the items, address or payment method of the session's open
 * draft. Server-only.
 *
 * LIVE. The draft is the session's open draft of the contact customer (`openDraftFor`); none is
 * `not_found` (an only-expired one is the hold-expired message). Changed lines are scope- and
 * stock-checked first (the draft's own held quantities credited); lines equal to the stored ones
 * are left out of the patch, so they are not reserved twice. The recipient phone stays the
 * contact's. Service errors map to static messages.
 *
 * TEST CHANNEL. No draft is ever stored there, so the dry run previews the change from the
 * arguments alone: it needs the items and the address (to price the delivery charge); the
 * payment method defaults to cod. Nothing is written; dryRunAction `update_order`.
 */
import "server-only";

import { z } from "zod";

import type { OrderDraftPatch } from "@/schemas/order";
import { updateDraftOrder } from "@/services/orders/drafts";
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
  orderCtxOf,
  paymentMethodInputSchema,
  previewFields,
  previewSummary,
  sameLines,
  sessionDrafts,
  shippingAddressOf,
  type DraftOutput,
} from "./order-access";
import { defineTool, isLiveChannel, toolFailure, type ToolContext, type ToolOutcome } from "./types";

const inputSchema = z.object({
  lines: linesInputSchema
    .optional()
    .describe("The full new list of items (replaces all lines). Omit to keep the items."),
  address: addressInputSchema.optional().describe("The full new delivery address. Omit to keep it."),
  paymentMethod: paymentMethodInputSchema.optional(),
});
type UpdateInput = z.output<typeof inputSchema>;

async function preview(ctx: ToolContext, input: UpdateInput): Promise<ToolOutcome<DraftOutput>> {
  if (!input.lines || !input.address) {
    return toolFailure("invalid", ORDER_MESSAGES.previewNeedsDetails);
  }
  const checked = await checkLines(ctx, input.lines);
  if (!checked.ok) return checked;
  const settings = await getOrderSettings(ctx.organizationId);
  const address = input.address;
  return guarded("edit", async () => ({
    ok: true,
    data: previewSummary(checked.lines, address.zone, input.paymentMethod ?? "cod", settings),
    dryRunAction: {
      kind: "update_order",
      fields: previewFields(checked.lines, address, input.paymentMethod),
    },
  }));
}

async function run(ctx: ToolContext, input: UpdateInput): Promise<ToolOutcome<DraftOutput>> {
  if (!isLiveChannel(ctx.channel)) return preview(ctx, input);

  const customer = await contactCustomer(ctx);
  if (!customer) return toolFailure("denied", CONTACT_DENIED);
  if (!input.lines && !input.address && !input.paymentMethod) {
    return toolFailure("invalid", ORDER_MESSAGES.nothingToChange);
  }

  const drafts = await sessionDrafts(ctx, customer.id);
  const draft = drafts.find((o) => !isOrderExpired(o));
  if (!draft) {
    return drafts.length > 0
      ? toolFailure("invalid", ORDER_MESSAGES.expired)
      : toolFailure("not_found", ORDER_MESSAGES.noDraftToUpdate);
  }

  const patch: OrderDraftPatch = {};
  // Unchanged lines are dropped from the patch: re-reserving them would need the stock twice.
  if (input.lines && !sameLines(draft.lines, input.lines)) {
    // The draft's own held stock is credited to its edit.
    const checked = await checkLines(ctx, input.lines, draft.lines);
    if (!checked.ok) return checked;
    patch.lines = checked.lines.map((l) => ({
      productId: l.productId,
      variantId: l.variantId,
      quantity: l.quantity,
    }));
  }
  if (input.address) {
    const shippingAddress = shippingAddressOf(input.address, customer.phoneE164);
    if (!shippingAddress) return toolFailure("invalid", ORDER_MESSAGES.badAddress);
    patch.shippingAddress = shippingAddress;
  }
  if (input.paymentMethod) patch.paymentMethod = input.paymentMethod;
  // Only unchanged lines were sent: nothing changes, so the draft is reported as it is.
  if (Object.keys(patch).length === 0) return { ok: true, data: draftSummary(draft) };

  return guarded("edit", async () => {
    const updated = await updateDraftOrder(orderCtxOf(ctx), draft.id, patch);
    return { ok: true, data: draftSummary(updated) };
  });
}

export const updateDraftOrderTool = defineTool<UpdateInput, DraftOutput>({
  name: "update_draft_order",
  description:
    "Change the open draft order of this conversation: send only what changes - the full new " +
    "list of items, the full new delivery address, or the payment method. Returns the new " +
    "summary with delivery charge and total; show it to the customer again before confirming.",
  input: inputSchema,
  output: draftOutputSchema,
  writes: true,
  run,
});
