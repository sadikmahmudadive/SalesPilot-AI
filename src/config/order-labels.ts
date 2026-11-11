import {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  type Order,
  type OrderStatus,
  type PaymentStatus,
} from "@/schemas/order";
import type { OrderAction } from "@/services/orders/state-machine";

/** Badge variants understood by `components/ui/badge`. */
export type OrderBadgeVariant = "default" | "secondary" | "outline" | "destructive";

/** Human labels and badge styles for order enums: the single source for tables, filters and the detail page. */
export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  draft: "Draft",
  confirmed: "Confirmed",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  returned: "Returned",
};

export const ORDER_STATUS_VARIANTS: Readonly<Record<OrderStatus, OrderBadgeVariant>> = {
  draft: "outline",
  confirmed: "secondary",
  processing: "secondary",
  shipped: "secondary",
  delivered: "default",
  cancelled: "destructive",
  returned: "destructive",
};

export const PAYMENT_STATUS_LABELS: Readonly<Record<PaymentStatus, string>> = {
  cod_pending: "COD pending",
  cod_collected: "COD collected",
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  failed: "Payment failed",
  refunded: "Refunded",
};

export const PAYMENT_STATUS_VARIANTS: Readonly<Record<PaymentStatus, OrderBadgeVariant>> = {
  cod_pending: "outline",
  cod_collected: "default",
  awaiting_payment: "outline",
  paid: "default",
  failed: "destructive",
  refunded: "secondary",
};

/** `{ value, label }` lists for select controls, in schema order. */
export const ORDER_STATUS_OPTIONS = ORDER_STATUSES.map((value) => ({
  value,
  label: ORDER_STATUS_LABELS[value],
}));

export const PAYMENT_STATUS_OPTIONS = PAYMENT_STATUSES.map((value) => ({
  value,
  label: PAYMENT_STATUS_LABELS[value],
}));

/** Every action the state machine knows, in its order. */
export const ORDER_ACTIONS: readonly OrderAction[] = [
  "confirm",
  "process",
  "ship",
  "deliver",
  "return",
  "cancel",
  "expire",
  "refund",
];

export const ACTION_LABELS: Readonly<Record<OrderAction, string>> = {
  confirm: "Confirm",
  process: "Start processing",
  ship: "Mark shipped",
  deliver: "Mark delivered",
  return: "Mark returned",
  cancel: "Cancel",
  expire: "Expire",
  refund: "Record refund",
};

/**
 * True for an order whose hold has run out but that the sweep has not cancelled yet: a draft, or
 * a confirmed order still awaiting payment (`awaiting_payment` / `failed`), whose `holdExpiresAt`
 * is at or before `now`. Mirrors the server's rule (the list API does not send `expired`).
 */
export function isHoldExpired(
  order: Pick<Order, "status" | "paymentStatus" | "holdExpiresAt">,
  now: number,
): boolean {
  const holds =
    order.status === "draft" ||
    (order.status === "confirmed" &&
      (order.paymentStatus === "awaiting_payment" || order.paymentStatus === "failed"));
  if (!holds || order.holdExpiresAt === null) return false;
  return Date.parse(order.holdExpiresAt) <= now;
}
