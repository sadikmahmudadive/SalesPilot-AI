/**
 * Pure logic behind the order form: form defaults, turning form values into the create body or a
 * minimal draft PATCH, the live totals preview, client-side validation (the same schema the API
 * uses) and mapping API errors onto rows and fields. No React, so it is unit tested directly.
 *
 * MONEY. The discount is typed in taka and parsed with `parseTakaToMinor` (string maths, never a
 * float); everything after that is integer paisa.
 */
import type { z } from "zod";

import type { OrderCreateBody, OrderDraftPatchBody } from "@/hooks/use-orders";
import { ApiError } from "@/lib/api/client";
import { mapApiErrorWith, type MappedApiError } from "@/lib/api/map-error";
import { formatMinorToTakaInput, parseTakaToMinor } from "@/lib/money";
import {
  DEFAULT_ORDER_SETTINGS,
  MAX_LINE_QUANTITY,
  orderCreateSchema,
  type DeliveryZone,
  type Order,
  type OrderSettings,
  type PaymentMethod,
} from "@/schemas/order";
import type { Product } from "@/schemas/product";
import { DEFAULT_VARIANT_ID } from "@/schemas/product";
import { priceOrder, type PricingResult } from "@/services/orders/pricing";

export interface OrderFormLine {
  productId: string;
  /** Blank for a product without variants. */
  variantId: string;
  /** Typed text; parsed when the body is built. */
  quantity: string;
}

export interface OrderFormAddress {
  recipientName: string;
  phone: string;
  line1: string;
  area: string;
  district: string;
  /** Blank until chosen: the delivery charge depends on it, so it is never guessed. */
  zone: DeliveryZone | "";
  note: string;
}

export interface OrderFormValues {
  customerId: string;
  lines: OrderFormLine[];
  address: OrderFormAddress;
  paymentMethod: PaymentMethod;
  /** Taka text, e.g. "150.50". Blank means no discount. */
  discount: string;
  notes: string;
}

export const EMPTY_ORDER_LINE: OrderFormLine = { productId: "", variantId: "", quantity: "1" };

export const EMPTY_ORDER_VALUES: OrderFormValues = {
  customerId: "",
  lines: [],
  address: { recipientName: "", phone: "", line1: "", area: "", district: "", zone: "", note: "" },
  paymentMethod: "cod",
  discount: "",
  notes: "",
};

/** A fresh idempotency key: 32 hex characters (a UUID without dashes). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

// ---- catalogue helpers ------------------------------------------------------------------------

/** Retail unit price: the sale price when there is one, else the regular price (what the server charges staff orders). */
export function retailPriceMinor(
  product: Pick<Product, "regularPriceMinor" | "salePriceMinor">,
): number {
  return product.salePriceMinor ?? product.regularPriceMinor;
}

/** "size / color" for a variant (whichever exist). */
export function variantLabel(variant: { size?: string; color?: string }): string {
  const parts = [variant.size, variant.color].filter((x): x is string => !!x && x.trim() !== "");
  return parts.length > 0 ? parts.join(" / ") : "Default";
}

/** The inventory unit id a line draws on. */
export const stockUnitId = (variantId: string): string =>
  variantId.trim() === "" ? DEFAULT_VARIANT_ID : variantId;

// ---- stored order -> form ---------------------------------------------------------------------

export function orderToFormValues(order: Order): OrderFormValues {
  const a = order.shippingAddress;
  return {
    customerId: order.customerId,
    lines: order.lines.map((l) => ({
      productId: l.productId,
      // The reserved `default` unit is "no variant" to the API.
      variantId: l.variantId === DEFAULT_VARIANT_ID ? "" : l.variantId,
      quantity: String(l.quantity),
    })),
    address: {
      recipientName: a.recipientName,
      phone: a.phone,
      line1: a.line1,
      area: a.area ?? "",
      district: a.district ?? "",
      zone: a.zone,
      note: a.note ?? "",
    },
    paymentMethod: order.paymentMethod,
    discount: formatMinorToTakaInput(order.discountMinor),
    notes: order.notes ?? "",
  };
}

// ---- form -> request body ---------------------------------------------------------------------

type CreateLine = OrderCreateBody["lines"][number];
type CreateAddress = OrderCreateBody["shippingAddress"];

const text = (v: string | undefined): string | undefined => {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : undefined;
};

/** Blank is zero. An unparseable amount becomes NaN, which the schema rejects (see `validateOrderForm`). */
function discountMinorOf(raw: string): number {
  if (raw.trim() === "") return 0;
  const parsed = parseTakaToMinor(raw);
  return parsed.ok ? parsed.minor : Number.NaN;
}

/** Plain digits only ("12"); "1e2", "0x10", "+5" and "1.0" are NaN, never a quantity. */
function parseQuantityText(raw: string): number {
  const t = raw.trim();
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}

function prepareLines(lines: readonly OrderFormLine[]): CreateLine[] {
  return lines.map((l) => {
    const variantId = text(l.variantId);
    const quantity = parseQuantityText(l.quantity);
    return {
      productId: l.productId.trim(),
      ...(variantId ? { variantId } : {}),
      quantity,
    };
  });
}

function prepareAddress(a: OrderFormAddress): CreateAddress {
  const area = text(a.area);
  const district = text(a.district);
  const note = text(a.note);
  return {
    recipientName: a.recipientName.trim(),
    phone: a.phone.trim(),
    line1: a.line1.trim(),
    ...(area ? { area } : {}),
    ...(district ? { district } : {}),
    // A blank zone fails validation ("Choose a delivery zone"): it is never defaulted.
    zone: a.zone as DeliveryZone,
    ...(note ? { note } : {}),
  };
}

/** The create request: trimmed, blank optionals dropped, discount in paisa. `idempotencyKey` is passed through. */
export function toCreateBody(
  values: OrderFormValues,
  idempotencyKey: string,
  confirm: boolean,
): OrderCreateBody {
  const notes = text(values.notes);
  return {
    customerId: values.customerId.trim(),
    lines: prepareLines(values.lines),
    shippingAddress: prepareAddress(values.address),
    paymentMethod: values.paymentMethod,
    discountMinor: discountMinorOf(values.discount),
    ...(notes ? { notes } : {}),
    confirm,
    idempotencyKey,
  };
}

export interface IdempotencyBinding {
  fingerprint: string;
  key: string;
}

/**
 * The idempotency key for submitting `values` as a new order. The key is bound to what is being
 * created (the body without `confirm` and the key): the same contents reuse the key, so a retry or
 * double click lands on the same order; any change gets a new key, so an edited resubmit can never
 * be answered with an earlier draft. Returns `previous` itself when it still applies.
 */
export function bindIdempotencyKey(
  previous: IdempotencyBinding | null,
  values: OrderFormValues,
  makeKey: () => string = newIdempotencyKey,
): IdempotencyBinding {
  const fingerprint = JSON.stringify(toCreateBody(values, "", false));
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, key: makeKey() };
}

/**
 * After a failed create, can a draft nevertheless exist (confirm refused, network lost)? False only
 * when the server refused the input or the caller outright.
 */
export function isCreateOutcomeUnknown(error: ApiError): boolean {
  return !["VALIDATION_ERROR", "UNAUTHENTICATED", "FORBIDDEN"].includes(error.code);
}

export const DRAFT_MAY_EXIST_NOTE = "If a draft was saved, it appears in Orders.";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The minimal PATCH for editing a draft: only fields that changed. Lines and the address are sent
 * whole when any part changes (the API replaces them); cleared notes are sent as an empty string.
 */
export function buildDraftPatch(
  initial: OrderFormValues,
  next: OrderFormValues,
): OrderDraftPatchBody {
  const patch: OrderDraftPatchBody = {};
  const lines = prepareLines(next.lines);
  if (!same(prepareLines(initial.lines), lines)) patch.lines = lines;
  const address = prepareAddress(next.address);
  if (!same(prepareAddress(initial.address), address)) patch.shippingAddress = address;
  if (initial.paymentMethod !== next.paymentMethod) patch.paymentMethod = next.paymentMethod;
  const discount = discountMinorOf(next.discount);
  if (!Object.is(discountMinorOf(initial.discount), discount)) patch.discountMinor = discount;
  if ((text(initial.notes) ?? "") !== (text(next.notes) ?? ""))
    patch.notes = text(next.notes) ?? "";
  return patch;
}

// ---- live totals ------------------------------------------------------------------------------

/**
 * Totals for the summary card, or null when they cannot be shown yet: no lines, a line without a
 * product, a known price or a whole quantity (1 to 1000), a bad discount (including more than the
 * subtotal) or no delivery zone. `unitPrices` maps `productId` to the retail unit price. Never
 * throws: `priceOrder` rejects those inputs, so they are screened (and any rejection caught) first.
 */
export function previewTotals(
  values: OrderFormValues,
  unitPrices: ReadonlyMap<string, number>,
  settings: OrderSettings = DEFAULT_ORDER_SETTINGS,
): PricingResult | null {
  if (values.lines.length === 0 || values.address.zone === "") return null;
  const lines: Array<{ unitPriceMinor: number; quantity: number }> = [];
  for (const line of values.lines) {
    const price = unitPrices.get(line.productId);
    const quantity = parseQuantityText(line.quantity);
    if (
      line.productId === "" ||
      price === undefined ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_LINE_QUANTITY
    ) {
      return null;
    }
    lines.push({ unitPriceMinor: price, quantity });
  }
  const discountMinor = discountMinorOf(values.discount);
  if (Number.isNaN(discountMinor)) return null;
  try {
    return priceOrder({ lines, discountMinor, zone: values.address.zone, settings });
  } catch {
    return null;
  }
}

// ---- validation and error mapping -------------------------------------------------------------

/** Names of the fields (and rows) errors are shown on. */
export type OrderFieldName =
  | "customerId"
  | "paymentMethod"
  | "discount"
  | "notes"
  | "lines.root"
  | `lines.${number}.${"productId" | "variantId" | "quantity" | "root"}`
  | `address.${"recipientName" | "phone" | "line1" | "area" | "district" | "zone" | "note"}`;

const ADDRESS_FIELDS = new Set([
  "recipientName",
  "phone",
  "line1",
  "area",
  "district",
  "zone",
  "note",
]);

/** Static copy for the machine messages the API sends for a failing line. */
const LINE_MESSAGES: Readonly<Record<string, string>> = {
  out_of_stock: "Not enough stock",
  unavailable: "This product isn't available",
  invalid_variant: "Choose a variant",
};

const friendly = (message: string): string => LINE_MESSAGES[message] ?? message;

/** Maps an API / schema path ("lines.2", "shippingAddress.phone", "discountMinor") onto a field, or null. */
export function toOrderFieldName(path: string): OrderFieldName | null {
  const parts = path.split(".");
  const [head, second, third] = parts;
  if (head === "lines") {
    if (second === undefined) return "lines.root";
    if (!/^\d+$/.test(second)) return null;
    const field =
      third === "productId" || third === "variantId" || third === "quantity" ? third : "root";
    return `lines.${Number(second)}.${field}`;
  }
  if (head === "shippingAddress") {
    return second !== undefined && ADDRESS_FIELDS.has(second)
      ? (`address.${second}` as OrderFieldName)
      : null;
  }
  if (head === "discountMinor") return "discount";
  if (head === "customerId" || head === "paymentMethod" || head === "notes") return head;
  return null;
}

export type MappedOrderApiError = MappedApiError<OrderFieldName>;

/** Turns a failed save into per-row/field errors plus (at most) one form-level message. */
export function mapOrderApiError(error: ApiError): MappedOrderApiError {
  const friendlyError = new ApiError({
    status: error.status,
    code: error.code,
    message: error.message,
    requestId: error.requestId,
    details: error.details.map((d) => ({ path: d.path, message: friendly(d.message) })),
  });
  return mapApiErrorWith(friendlyError, {
    toField: toOrderFieldName,
    // 409s ("still being prepared", "another change in progress") are shown as the server words them.
    onConflict: (e) => ({ fields: [], formError: e.message }),
  });
}

export type OrderFormValidation =
  { ok: true } | { ok: false; fields: Array<{ name: OrderFieldName; message: string }> };

const VALIDATION_ONLY_KEY = "validation-only-key";

/** Checks the form against the API's own create schema, so messages and paths match the server's. */
export function validateOrderForm(values: OrderFormValues): OrderFormValidation {
  const fields: Array<{ name: OrderFieldName; message: string }> = [];
  const seen = new Set<string>();
  const add = (name: OrderFieldName, message: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    fields.push({ name, message });
  };

  if (values.discount.trim() !== "") {
    const parsed = parseTakaToMinor(values.discount);
    if (!parsed.ok) add("discount", parsed.message);
  }

  const result = orderCreateSchema.safeParse(toCreateBody(values, VALIDATION_ONLY_KEY, false));
  if (!result.success) {
    for (const issue of (result.error as z.ZodError).issues) {
      const name = toOrderFieldName(issue.path.join("."));
      if (!name) continue;
      if (name === "customerId") add(name, "Choose a customer");
      else if (name.endsWith(".productId")) add(name, "Choose a product");
      else add(name, issue.message);
    }
  }
  return fields.length === 0 ? { ok: true } : { ok: false, fields };
}

/** The message of the react-hook-form error stored at `path` ("lines.0.root"), if any. */
export function errorMessageAt(errors: unknown, path: string): string | undefined {
  let node: unknown = errors;
  for (const key of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  const message = (node as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" ? message : undefined;
}
