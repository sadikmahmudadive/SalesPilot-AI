import type { CourierProvider, CourierStatus } from "@/schemas/courier";
import type { OrderStatus } from "@/schemas/order";

/**
 * Normalizes raw status string: lowercase, trims, and replaces hyphens and spaces with underscores.
 */
function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[-\s]+/g, "_");
}

/**
 * Steadfast status dictionary.
 * Standard statuses from Steadfast API documentation.
 */
const STEADFAST_MAP: Record<string, CourierStatus> = {
  in_review: "booked",
  pending: "pending_pickup",
  picked_up: "picked_up",
  picked: "picked_up",
  in_transit: "in_transit",
  transit: "in_transit",
  holding: "out_for_delivery",
  out_for_delivery: "out_for_delivery",
  delivery: "out_for_delivery",
  delivered: "delivered",
  delivered_approval_pending: "delivered",
  partial_delivered: "partial_delivered",
  partial_delivery: "partial_delivered",
  partial_delivered_approval_pending: "partial_delivered",
  cancelled: "cancelled",
  cancelled_approval_pending: "cancelled",
  hold: "on_hold",
  on_hold: "on_hold",
  unknown_approval_pending: "unknown",
  unknown: "unknown",
  return: "returned",
  returned: "returned",
};

/**
 * Pathao status dictionary.
 * Standard statuses from Pathao Courier API v1.
 */
const PATHAO_MAP: Record<string, CourierStatus> = {
  pending: "pending_pickup",
  accepted: "pending_pickup",
  picking: "pending_pickup",
  picked: "picked_up",
  picked_up: "picked_up",
  in_transit: "in_transit",
  at_sorting_hub: "in_transit",
  assigned_for_delivery: "out_for_delivery",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
  partial_delivery: "partial_delivered",
  partial_delivered: "partial_delivered",
  return: "returned",
  returned: "returned",
  return_in_transit: "returned",
  return_at_sorting_hub: "returned",
  return_assigned: "returned",
  return_received: "returned",
  cancelled: "cancelled",
  on_hold: "on_hold",
  hold: "on_hold",
  unknown: "unknown",
};

/**
 * RedX status dictionary.
 * Standard statuses from RedX API v1.0.0-beta.
 */
const REDX_MAP: Record<string, CourierStatus> = {
  pickup_pending: "pending_pickup",
  picked_up: "picked_up",
  received_at_hub: "in_transit",
  in_transit: "in_transit",
  delivery_in_progress: "out_for_delivery",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
  partial_delivered: "partial_delivered",
  returned_to_hub: "returned",
  returned: "returned",
  return_in_progress: "returned",
  cancelled: "cancelled",
  hold: "on_hold",
  on_hold: "on_hold",
  unknown: "unknown",
};

/**
 * Mock courier status dictionary.
 */
const MOCK_MAP: Record<string, CourierStatus> = {
  booked: "booked",
  pending_pickup: "pending_pickup",
  picked_up: "picked_up",
  in_transit: "in_transit",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
  partial_delivered: "partial_delivered",
  returned: "returned",
  cancelled: "cancelled",
  on_hold: "on_hold",
  unknown: "unknown",
};

export function mapSteadfastStatus(raw: string): CourierStatus {
  const key = normalizeKey(raw);
  return STEADFAST_MAP[key] ?? "unknown";
}

export function mapPathaoStatus(raw: string): CourierStatus {
  const key = normalizeKey(raw);
  return PATHAO_MAP[key] ?? "unknown";
}

export function mapRedxStatus(raw: string): CourierStatus {
  const key = normalizeKey(raw);
  return REDX_MAP[key] ?? "unknown";
}

export function mapMockStatus(raw: string): CourierStatus {
  const key = normalizeKey(raw);
  return MOCK_MAP[key] ?? "unknown";
}

export function mapCourierStatus(provider: CourierProvider, raw: string): CourierStatus {
  if (!raw || typeof raw !== "string") return "unknown";
  switch (provider) {
    case "steadfast":
      return mapSteadfastStatus(raw);
    case "pathao":
      return mapPathaoStatus(raw);
    case "redx":
      return mapRedxStatus(raw);
    case "mock":
      return mapMockStatus(raw);
    default:
      return "unknown";
  }
}

export interface OrderLifecycleEffect {
  targetOrderStatus?: OrderStatus;
  commitStock?: boolean;
  codCollected?: boolean;
}

/**
 * Returns the order lifecycle change implied by a given courier status.
 */
export function toOrderLifecycleEffect(status: CourierStatus): OrderLifecycleEffect | null {
  switch (status) {
    case "picked_up":
    case "in_transit":
    case "out_for_delivery":
      return { targetOrderStatus: "shipped", commitStock: true };
    case "delivered":
    case "partial_delivered":
      return { targetOrderStatus: "delivered", codCollected: true };
    case "returned":
      return { targetOrderStatus: "returned" };
    default:
      return null;
  }
}
