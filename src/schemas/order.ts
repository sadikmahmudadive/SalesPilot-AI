/**
 * Order schemas and persisted shapes. Pure (shared by API routes, services, AI tools and the UI).
 *
 * MONEY. Integer minor units (paisa), never floats. `currency` is always "BDT".
 *
 * MANAGED FIELDS. `phoneE164` on the shipping address is derived here from `phone` and never read
 * from a client (object schemas strip unknown keys). Order numbers, totals, statuses and hold
 * state are computed by the service.
 */
import { z } from "zod";

import { isValidIdSegment } from "@/lib/ids";
import { normalizePhone } from "@/lib/phone";

import { phoneInputSchema } from "./customer";

export const MAX_ORDER_LINES = 20;
export const MAX_LINE_QUANTITY = 1000;

export const ORDER_STATUSES = [
  "draft",
  "confirmed",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "returned",
] as const;
export const PAYMENT_STATUSES = [
  "cod_pending",
  "cod_collected",
  "awaiting_payment",
  "paid",
  "failed",
  "refunded",
] as const;
export const PAYMENT_METHODS = ["cod", "online"] as const;
export const DELIVERY_ZONES = ["inside_dhaka", "outside_dhaka"] as const;
export const LINE_HOLD_STATES = ["pending", "held", "released", "committed"] as const;
export const STOCK_STATES = [
  "pending",
  "held",
  "releasing",
  "released",
  "committing",
  "committed",
] as const;
export const ORDER_EVENT_TYPES = [
  "created",
  "updated",
  "status_changed",
  "stock_released",
  "stock_committed",
  "refund_recorded",
  "note",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type DeliveryZone = (typeof DELIVERY_ZONES)[number];
export type LineHoldState = (typeof LINE_HOLD_STATES)[number];
export type StockState = (typeof STOCK_STATES)[number];
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

/** Money cap shared with product prices (1_000_000_000 paisa). */
const MAX_MONEY_MINOR = 1_000_000_000;

// Static messages: they never echo the submitted value (it may be PII).
const ID_MESSAGE = "Enter a valid id";
const id = z
  .string({ error: ID_MESSAGE })
  .refine((v) => isValidIdSegment(v), { error: ID_MESSAGE });

const reasonText = z
  .string({ error: "Enter a reason" })
  .trim()
  .min(1, "Enter a reason")
  .max(300, "Use 300 characters or fewer");

export const orderLineInputSchema = z.object({
  productId: id,
  variantId: id.optional(),
  quantity: z
    .number({ error: `Enter a quantity from 1 to ${MAX_LINE_QUANTITY}` })
    .int({ error: `Enter a quantity from 1 to ${MAX_LINE_QUANTITY}` })
    .min(1, { error: `Enter a quantity from 1 to ${MAX_LINE_QUANTITY}` })
    .max(MAX_LINE_QUANTITY, { error: `Enter a quantity from 1 to ${MAX_LINE_QUANTITY}` }),
});

export const shippingAddressSchema = z
  .object({
    recipientName: z
      .string({ error: "Enter the recipient's name" })
      .trim()
      .min(1, "Enter the recipient's name")
      .max(120, "Use 120 characters or fewer"),
    phone: phoneInputSchema,
    line1: z
      .string({ error: "Enter the delivery address" })
      .trim()
      .min(1, "Enter the delivery address")
      .max(300, "Use 300 characters or fewer"),
    area: z.string().trim().max(120, "Use 120 characters or fewer").optional(),
    district: z.string().trim().max(120, "Use 120 characters or fewer").optional(),
    zone: z.enum(DELIVERY_ZONES, { error: "Choose a delivery zone" }),
    note: z.string().trim().max(500, "Use 500 characters or fewer").optional(),
  })
  .transform((v) => ({ ...v, phoneE164: normalizePhone(v.phone) as string }));

const linesField = z
  .array(orderLineInputSchema, { error: "Add at least one item" })
  .min(1, "Add at least one item")
  .max(MAX_ORDER_LINES, `Use at most ${MAX_ORDER_LINES} items`);
const paymentMethodField = z.enum(PAYMENT_METHODS, { error: "Choose a payment method" });
const discountField = z
  .number({ error: "Enter a whole number of paisa (0 or more)" })
  .int({ error: "Enter a whole number of paisa (0 or more)" })
  .min(0, { error: "Enter a whole number of paisa (0 or more)" })
  .max(MAX_MONEY_MINOR, { error: "Enter a whole number of paisa (0 or more)" });
const notesField = z.string().trim().max(1000, "Use 1000 characters or fewer");

/**
 * The 409 message of a create whose idempotency key belongs to an order that was cancelled or is
 * an expired draft (a spent key). The new-order form matches it to mint a fresh key (R20).
 */
export const ORDER_ATTEMPT_ENDED_MESSAGE = "That order attempt has ended, submit again";

export const orderCreateSchema = z.object({
  customerId: id,
  lines: linesField,
  shippingAddress: shippingAddressSchema,
  paymentMethod: paymentMethodField,
  discountMinor: discountField.default(0),
  notes: notesField.optional(),
  confirm: z.boolean().default(false),
  idempotencyKey: z
    .string({ error: "Enter a valid idempotency key" })
    .regex(/^[A-Za-z0-9_-]{8,128}$/, { error: "Enter a valid idempotency key" }),
});

/** PATCH body for a draft: every field optional, no defaults, at least one present. */
export const orderDraftPatchSchema = z
  .object({
    lines: linesField,
    shippingAddress: shippingAddressSchema,
    paymentMethod: paymentMethodField,
    discountMinor: discountField,
    notes: notesField,
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    error: "At least one field is required",
  });

export const reasonSchema = z.object({ reason: reasonText });

export const processSchema = z.object({ allowUnpaidReason: reasonText.optional() });

const chargeField = z
  .number({ error: "Enter a whole number of paisa (0 to 1000000)" })
  .int({ error: "Enter a whole number of paisa (0 to 1000000)" })
  .min(0, { error: "Enter a whole number of paisa (0 to 1000000)" })
  .max(1_000_000, { error: "Enter a whole number of paisa (0 to 1000000)" });

export const orderSettingsSchema = z.object({
  deliveryChargeInsideDhakaMinor: chargeField,
  deliveryChargeOutsideDhakaMinor: chargeField,
  draftHoldMinutes: z
    .number({ error: "Enter 5 to 1440 minutes" })
    .int({ error: "Enter 5 to 1440 minutes" })
    .min(5, { error: "Enter 5 to 1440 minutes" })
    .max(1440, { error: "Enter 5 to 1440 minutes" }),
  paymentHoldHours: z
    .number({ error: "Enter 1 to 168 hours" })
    .int({ error: "Enter 1 to 168 hours" })
    .min(1, { error: "Enter 1 to 168 hours" })
    .max(168, { error: "Enter 1 to 168 hours" }),
});

export const orderListQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  customerId: id.optional(),
  /** Order number or phone. */
  q: z.string().trim().min(1).max(100).optional(),
  from: z.iso.datetime({ offset: true, error: "Enter a valid date and time" }).optional(),
  to: z.iso.datetime({ offset: true, error: "Enter a valid date and time" }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(1000).optional(),
});

export type OrderLineInput = z.output<typeof orderLineInputSchema>;
export type ShippingAddress = z.output<typeof shippingAddressSchema>;
export type OrderCreateInput = z.output<typeof orderCreateSchema>;
export type OrderDraftPatch = z.output<typeof orderDraftPatchSchema>;
export type OrderSettings = z.output<typeof orderSettingsSchema>;
export type OrderListQuery = z.output<typeof orderListQuerySchema>;

export const DEFAULT_ORDER_SETTINGS: OrderSettings = {
  deliveryChargeInsideDhakaMinor: 6000,
  deliveryChargeOutsideDhakaMinor: 12000,
  draftHoldMinutes: 30,
  paymentHoldHours: 24,
};

export interface OrderLine {
  productId: string;
  variantId: string;
  productName: string;
  variantLabel: string | null;
  sku: string | null;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
  holdKey: string;
  holdState: LineHoldState;
}

export interface Order {
  id: string;
  organizationId: string;
  orderNumber: string;
  status: OrderStatus;
  source: "ai" | "staff";
  createdBy: { kind: "ai"; agentId: string; sessionId: string } | { kind: "user"; uid: string };
  customerId: string;
  customerSnapshot: { name: string; phoneE164: string };
  shippingAddress: ShippingAddress;
  lines: OrderLine[];
  pendingLines: OrderLine[] | null;
  /**
   * Lines that left the order (replaced by an edit, or reserved after the order ended) whose
   * stock may still be reserved. Kept reachable until released; `hasReleasingLines` is the
   * single-field flag the sweep queries.
   */
  releasingLines: OrderLine[] | null;
  hasReleasingLines: boolean;
  revision: number;
  subtotalMinor: number;
  discountMinor: number;
  deliveryChargeMinor: number;
  totalMinor: number;
  currency: "BDT";
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  holdExpiresAt: string | null;
  stockState: StockState;
  /**
   * Set by the sweep when committing the stock failed terminally (a reservation was released or
   * is unknown: corruption). The sweep no longer retries such an order; staff must fix inventory.
   */
  stockAlert: "commit_failed" | null;
  conversationId: string | null;
  notes: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  refund: { reason: string; at: string; by: string } | null;
  allowUnpaidReason: string | null;
}

export interface OrderEvent {
  id: string;
  organizationId: string;
  orderId: string;
  type: OrderEventType;
  from: string | null;
  to: string | null;
  actor: { kind: "ai" | "user" | "system"; id: string };
  detail: string | null;
  createdAt: string;
}
