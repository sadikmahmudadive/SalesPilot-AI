/**
 * Shared rules of the AI order tools. Server-only.
 *
 * BINDING. The order tools never take a customer id or phone from the model: on live channels the
 * customer is the conversing contact (`ctx.contactPhoneE164`, set by the channel layer), found
 * through the phone lock (`findCustomerByPhone`). No contact, or a contact without a customer
 * record, is `denied` (`CONTACT_DENIED`). On the test channel there is no contact: the tools run
 * as a dry run and write nothing.
 *
 * SESSION DRAFT (Ruling R3). A session has at most one OPEN draft: the newest of the customer's
 * latest 10 orders that is a `draft` created by the AI in this session (`createdBy.sessionId`)
 * and whose hold has not expired. It is found in memory over the existing customerId + createdAt
 * index; no new index.
 *
 * SCOPE. `createDraftOrder` knows nothing about the agent's `productAccess`, so every line is
 * checked here first (`checkLines`): a missing, inactive or out-of-scope product is "One item
 * isn't available.", whatever the reason, so nothing about it leaks.
 *
 * MESSAGES. Every failure is static and never echoes the model's arguments (the confirmation
 * quote included). Service errors map through `orderFailure`.
 */
import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { ConflictError, InventoryBusyError, ValidationError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { formatMoneyMinor } from "@/lib/format";
import { logger } from "@/lib/logger";
import { writeAuditInTransaction } from "@/lib/security/audit";
import { stableJson } from "@/lib/stable-json";
import type { CustomerDoc } from "@/repositories/customers";
import { buildOrderEvent } from "@/repositories/orders";
import {
  DELIVERY_ZONES,
  MAX_LINE_QUANTITY,
  MAX_ORDER_LINES,
  PAYMENT_METHODS,
  type DeliveryZone,
  type Order,
  type OrderLine,
  type OrderSettings,
  type PaymentMethod,
  type ShippingAddress,
  shippingAddressSchema,
} from "@/schemas/order";
import { DEFAULT_VARIANT_ID, type Product } from "@/schemas/product";
import { variantLabelOf } from "@/services/inventory/inventory-query";
import { eventActorOf } from "@/services/orders/drafts";
import { priceOrder } from "@/services/orders/pricing";
import { isOrderExpired, listCustomerOrders } from "@/services/orders/queries";
import type { OrderCtx } from "@/services/orders/settings";
import { OrderExpiredError, OrderTransitionError } from "@/services/orders/state-machine";
import { OrderLineError, type OrderLineProblem } from "@/services/orders/stock-holds";

import {
  isProductInScope,
  loadProduct,
  readAvailable,
  resolveUnit,
  retailMinor,
  stockUnitIds,
  unitKey,
} from "./catalog-access";
import { CONTACT_DENIED, findCustomerByPhone, phoneE164Of } from "./crm-access";
import { isLiveChannel, toolFailure, type ToolContext, type ToolOutcome } from "./types";

export { CONTACT_DENIED };

/** Order number shown by a dry run (nothing is stored on the test channel). */
export const PREVIEW_ORDER_NUMBER = "DRAFT-PREVIEW";
/** How many of the customer's newest orders are searched for the session's draft (R3). */
const SESSION_DRAFT_WINDOW = 10;
const MAX_QUOTE = 200;

// ---- static messages -----------------------------------------------------------------------

export const ORDER_MESSAGES = {
  outOfStock: "One item is out of stock.",
  unavailable: "One item isn't available.",
  invalidVariant: "Choose a size or colour for one item.",
  expired: "The order hold expired; create the order again.",
  busy: "The order is being updated; try again in a moment.",
  notConfirmable: "That order can't be confirmed any more.",
  notEditable: "That order can't be changed any more.",
  noDraftToUpdate: "There is no open order to update.",
  noDraftToConfirm: "There is no open order to confirm.",
  alreadyConfirmed: "This order is already confirmed.",
  cannotRecreate: "This order can't be created again in this conversation.",
  confirmFirst: "Ask the customer to confirm the summary first.",
  badAddress: "The delivery address is incomplete.",
  nothingToChange: "There is nothing to change.",
  previewNeedsDetails:
    "There is no saved order on the test console; include the items and the address to preview the change.",
  onlineNote:
    "Online payment links are not available yet; offer cash on delivery or tell the customer the team will send a link.",
} as const;

const LINE_MESSAGES: Readonly<Record<OrderLineProblem, string>> = {
  out_of_stock: ORDER_MESSAGES.outOfStock,
  unavailable: ORDER_MESSAGES.unavailable,
  invalid_variant: ORDER_MESSAGES.invalidVariant,
};

type Failure = { ok: false; code: "not_found" | "denied" | "invalid" | "failed"; message: string };

/**
 * The static failure for a known order-service error, or null (the caller rethrows, and the
 * executor reports `failed`). `confirm` picks the message for a draft that left `draft`.
 */
export function orderFailure(err: unknown, action: "edit" | "confirm"): Failure | null {
  if (err instanceof OrderLineError) {
    const problem = err.details?.[0]?.message as OrderLineProblem | undefined;
    return toolFailure("invalid", (problem && LINE_MESSAGES[problem]) ?? ORDER_MESSAGES.unavailable);
  }
  if (err instanceof OrderExpiredError) return toolFailure("invalid", ORDER_MESSAGES.expired);
  if (err instanceof OrderTransitionError) {
    return toolFailure(
      "invalid",
      action === "confirm" ? ORDER_MESSAGES.notConfirmable : ORDER_MESSAGES.notEditable,
    );
  }
  if (err instanceof InventoryBusyError) return toolFailure("failed");
  // "This order is still being prepared" / "Another change to this order is in progress".
  if (err instanceof ConflictError) return toolFailure("failed", ORDER_MESSAGES.busy);
  if (err instanceof ValidationError) return toolFailure("invalid");
  return null;
}

// ---- contact and session draft -------------------------------------------------------------

/** The OrderCtx of an AI tool call (R1 actor). */
export function orderCtxOf(ctx: ToolContext): OrderCtx {
  return {
    organizationId: ctx.organizationId,
    uid: ctx.actorUid,
    actor: { kind: "ai", agentId: ctx.agent.id, sessionId: ctx.sessionId },
  };
}

/**
 * The conversing customer: on live channels the customer of `ctx.contactPhoneE164` (or null when
 * there is no contact or no customer record); on the test channel always null (dry run).
 */
export async function contactCustomer(ctx: ToolContext): Promise<CustomerDoc | null> {
  if (!isLiveChannel(ctx.channel)) return null;
  const phone = ctx.contactPhoneE164 ? phoneE164Of(ctx.contactPhoneE164) : null;
  if (!phone) return null;
  return findCustomerByPhone(ctx.organizationId, phone);
}

/** The customer's orders created by the AI in this session (any status), newest first. */
export async function sessionOrders(ctx: ToolContext, customerId: string): Promise<Order[]> {
  const orders = await listCustomerOrders(orderCtxOf(ctx), customerId, SESSION_DRAFT_WINDOW);
  return orders.filter(
    (o) => o.createdBy.kind === "ai" && o.createdBy.sessionId === ctx.sessionId,
  );
}

/** The customer's drafts created by the AI in this session, newest first (expired included). */
export async function sessionDrafts(ctx: ToolContext, customerId: string): Promise<Order[]> {
  return (await sessionOrders(ctx, customerId)).filter((o) => o.status === "draft");
}

/** True for an order that went past `draft` and was not cancelled (confirmed or later). */
export const isConfirmedOrLater = (order: Pick<Order, "status">): boolean =>
  order.status !== "draft" && order.status !== "cancelled";

/** Newest draft of this customer created by this session whose hold has not expired. */
export async function openDraftFor(ctx: ToolContext, customerId: string): Promise<Order | null> {
  const drafts = await sessionDrafts(ctx, customerId);
  return drafts.find((o) => !isOrderExpired(o)) ?? null;
}

/** `ai_${sha256(sessionId + stableJson(args)) hex[0..40]}`. */
export function toolIdempotencyKey(ctx: ToolContext, args: unknown): string {
  const hash = createHash("sha256")
    .update(ctx.sessionId + stableJson(args))
    .digest("hex")
    .slice(0, 40);
  return `ai_${hash}`;
}

// ---- input shapes --------------------------------------------------------------------------

export const lineInputSchema = z.object({
  productId: z.string().min(1).max(200).describe("Product id from the catalog tools."),
  variantId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Variant id, required when the product has sizes or colours."),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
});
export const linesInputSchema = z.array(lineInputSchema).min(1).max(MAX_ORDER_LINES);

export const addressInputSchema = z.object({
  recipientName: z.string().trim().min(1).max(120).describe("Who receives the parcel."),
  line1: z.string().trim().min(1).max(300).describe("House, road and area as the customer said it."),
  area: z.string().trim().max(120).optional(),
  district: z.string().trim().max(120).optional(),
  zone: z
    .enum(DELIVERY_ZONES)
    .describe("inside_dhaka or outside_dhaka; ask the customer if you are not sure."),
});
export const paymentMethodInputSchema = z
  .enum(PAYMENT_METHODS)
  .describe("cod (cash on delivery) or online.");

export type LineInput = z.output<typeof lineInputSchema>;
export type AddressInput = z.output<typeof addressInputSchema>;

/**
 * The stored shipping address of an address input: the recipient phone is always the contact's
 * (never a model argument). Null when the result fails the order address schema.
 */
export function shippingAddressOf(address: AddressInput, phoneE164: string): ShippingAddress | null {
  const raw: Record<string, unknown> = {
    recipientName: address.recipientName,
    phone: phoneE164,
    line1: address.line1,
    zone: address.zone,
  };
  if (address.area) raw.area = address.area;
  if (address.district) raw.district = address.district;
  const parsed = shippingAddressSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ---- line checks (reads only) --------------------------------------------------------------

/** The unit an input line names (`default` for a product without variants). */
const inputUnit = (l: LineInput) => ({
  productId: l.productId,
  variantId: l.variantId ?? DEFAULT_VARIANT_ID,
  quantity: l.quantity,
});
const storedUnit = (l: OrderLine) => ({
  productId: l.productId,
  variantId: l.variantId,
  quantity: l.quantity,
});

/** True when `lines` (as the model sent them) are exactly the stored lines, in order. */
export function sameLines(stored: readonly OrderLine[], lines: readonly LineInput[]): boolean {
  return stableJson(stored.map(storedUnit)) === stableJson(lines.map(inputUnit));
}

export interface CheckedLine {
  productId: string;
  variantId: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

const lineName = (product: Product, variantId: string): string =>
  product.variants.length > 0
    ? `${product.name} (${variantLabelOf(variantId, product.variants)})`
    : product.name;

/**
 * Checks every line against the agent's catalogue scope, the unit and the current stock (lines
 * of the same unit are summed), reading only. Returns the priced lines (retail price, as the
 * order service prices them) or the static failure of the FIRST failing line.
 */
export async function checkLines(
  ctx: ToolContext,
  lines: readonly LineInput[],
  ownHolds: readonly OrderLine[] = [],
): Promise<{ ok: true; lines: CheckedLine[] } | Failure> {
  const ids = [...new Set(lines.map((l) => l.productId))];
  const loaded = await Promise.all(ids.map((id) => loadProduct(ctx, id)));
  const products = new Map(ids.map((id, i) => [id, loaded[i] ?? null]));

  const resolved: Array<{ product: Product; variantId: string }> = [];
  for (const line of lines) {
    const product = products.get(line.productId) ?? null;
    if (!product || product.availability !== "active" || !isProductInScope(ctx.agent, product)) {
      return toolFailure("invalid", ORDER_MESSAGES.unavailable);
    }
    const unit = resolveUnit(product, line.variantId);
    if (unit.kind === "unit") {
      resolved.push({ product, variantId: unit.variantId });
    } else if (unit.kind === "none" && product.variants.length === 0) {
      resolved.push({ product, variantId: stockUnitIds(product)[0]! });
    } else {
      return toolFailure("invalid", ORDER_MESSAGES.invalidVariant);
    }
  }

  const available = await readAvailable(
    ctx,
    resolved.map((r) => ({ productId: r.product.id, variantId: r.variantId })),
  );
  // Stock the session's own draft already holds counts as available to that draft's edit.
  const credit = new Map<string, number>();
  for (const held of ownHolds) {
    if (held.holdState !== "held") continue;
    const key = unitKey(held);
    credit.set(key, (credit.get(key) ?? 0) + held.quantity);
  }
  const wanted = new Map<string, number>();
  const out: CheckedLine[] = [];
  for (const [i, r] of resolved.entries()) {
    const quantity = lines[i]!.quantity;
    const key = unitKey({ productId: r.product.id, variantId: r.variantId });
    const total = (wanted.get(key) ?? 0) + quantity;
    wanted.set(key, total);
    if (total > (available.get(key) ?? 0) + (credit.get(key) ?? 0)) {
      return toolFailure("invalid", ORDER_MESSAGES.outOfStock);
    }
    const unitPriceMinor = retailMinor(r.product);
    out.push({
      productId: r.product.id,
      variantId: r.variantId,
      name: lineName(r.product, r.variantId),
      quantity,
      unitPriceMinor,
      lineTotalMinor: unitPriceMinor * quantity,
    });
  }
  return { ok: true, lines: out };
}

// ---- summaries -----------------------------------------------------------------------------

export const draftOutputSchema = z.object({
  orderNumber: z.string(),
  lines: z.array(z.object({ name: z.string(), quantity: z.number().int(), lineTotalText: z.string() })),
  subtotalText: z.string(),
  discountText: z.string().optional(),
  deliveryChargeText: z.string(),
  totalText: z.string(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  holdMinutes: z.number().int(),
});
export type DraftOutput = z.output<typeof draftOutputSchema>;

/** Whole minutes left on the hold (0 when it has run out). */
function holdMinutesOf(order: Pick<Order, "holdExpiresAt">, now = Date.now()): number {
  if (order.holdExpiresAt === null) return 0;
  return Math.max(0, Math.ceil((Date.parse(order.holdExpiresAt) - now) / 60_000));
}

/** The summary of a stored draft. */
export function draftSummary(order: Order): DraftOutput {
  const out: DraftOutput = {
    orderNumber: order.orderNumber,
    lines: order.lines.map((l) => ({
      name: l.variantLabel ? `${l.productName} (${l.variantLabel})` : l.productName,
      quantity: l.quantity,
      lineTotalText: formatMoneyMinor(l.lineTotalMinor),
    })),
    subtotalText: formatMoneyMinor(order.subtotalMinor),
    deliveryChargeText: formatMoneyMinor(order.deliveryChargeMinor),
    totalText: formatMoneyMinor(order.totalMinor),
    paymentMethod: order.paymentMethod,
    holdMinutes: holdMinutesOf(order),
  };
  if (order.discountMinor > 0) out.discountText = formatMoneyMinor(order.discountMinor);
  return out;
}

/** The summary a dry run reports: priced like the service, with the placeholder number. */
export function previewSummary(
  lines: readonly CheckedLine[],
  zone: DeliveryZone,
  paymentMethod: PaymentMethod,
  settings: OrderSettings,
): DraftOutput {
  const pricing = priceOrder({ lines: [...lines], discountMinor: 0, zone, settings });
  return {
    orderNumber: PREVIEW_ORDER_NUMBER,
    lines: lines.map((l) => ({
      name: l.name,
      quantity: l.quantity,
      lineTotalText: formatMoneyMinor(l.lineTotalMinor),
    })),
    subtotalText: formatMoneyMinor(pricing.subtotalMinor),
    deliveryChargeText: formatMoneyMinor(pricing.deliveryChargeMinor),
    totalText: formatMoneyMinor(pricing.totalMinor),
    paymentMethod,
    holdMinutes: settings.draftHoldMinutes,
  };
}

/** The `dryRunAction.fields` of a draft preview: what would be stored, without any phone. */
export function previewFields(
  lines: readonly CheckedLine[],
  address: AddressInput | undefined,
  paymentMethod: PaymentMethod | undefined,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    lines: lines.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity })),
  };
  if (address) fields.address = address;
  if (paymentMethod) fields.paymentMethod = paymentMethod;
  return fields;
}

// ---- confirmation quote --------------------------------------------------------------------

/** Control and format characters removed, whitespace collapsed, at most 200 code points. */
export function cleanConfirmationQuote(text: string): string {
  const cleaned = text
    .replace(/\s+/gu, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return Array.from(cleaned).slice(0, MAX_QUOTE).join("").trim();
}

/**
 * Appends the customer's confirmation words to the order timeline (`note` event, with an
 * `order.note` audit row in the same transaction). Best effort: the order is already confirmed,
 * so a failure is logged (order id only) and swallowed.
 */
export async function recordConfirmationQuote(
  ctx: ToolContext,
  orderId: string,
  quote: string,
): Promise<void> {
  const text = cleanConfirmationQuote(quote);
  if (text.length === 0) return;
  const orderCtx = orderCtxOf(ctx);
  try {
    await adminDb().runTransaction(async (tx) => {
      const event = buildOrderEvent(ctx.organizationId, {
        orderId,
        type: "note",
        from: null,
        to: null,
        actor: eventActorOf(orderCtx),
        detail: `Customer confirmed: ${text}`,
      });
      tx.create(event.ref, event.data);
      writeAuditInTransaction(tx, {
        organizationId: ctx.organizationId,
        actorUid: ctx.actorUid,
        action: "order.note",
        resource: "order",
        resourceId: orderId,
        after: { type: "confirmation_quote", length: text.length },
      });
    });
  } catch (err) {
    logger.warn("order confirmation quote could not be recorded", {
      orderId,
      error: err instanceof Error ? err.name : "unknown",
    });
  }
}

// ---- shared run helpers --------------------------------------------------------------------

/**
 * Runs a live order-service call, mapping known service errors to static failures and
 * rethrowing anything else (the executor turns it into `failed`).
 */
export async function guarded<T>(
  action: "edit" | "confirm",
  fn: () => Promise<ToolOutcome<T>>,
): Promise<ToolOutcome<T>> {
  try {
    return await fn();
  } catch (err) {
    const failure = orderFailure(err, action);
    if (failure) return failure;
    throw err;
  }
}
