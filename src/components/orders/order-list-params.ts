/** Pure mapping from the Orders list controls to API query parameters. */
import type { OrderListParams } from "@/hooks/use-orders";
import { PAGE_SIZE } from "@/lib/list-ui";
import { normalizePhone } from "@/lib/phone";
import type { OrderStatus, PaymentStatus } from "@/schemas/order";

export interface OrderFilterState {
  /** "" is "All". Status and payment status are mutually exclusive: the API takes one equality filter. */
  status: OrderStatus | "";
  paymentStatus: PaymentStatus | "";
  search: string;
}

export const DEFAULT_ORDER_FILTERS: OrderFilterState = {
  status: "",
  paymentStatus: "",
  search: "",
};

const ORDER_NUMBER = /^SP-\d+$/i;

export type OrderSearch = { kind: "none" } | { kind: "valid"; q: string } | { kind: "invalid" };

/** The search box accepts an order number (`SP-000123`) or a phone number; anything else sends no request. */
export function parseOrderSearch(raw: string): OrderSearch {
  const q = raw.trim();
  if (!q) return { kind: "none" };
  if (ORDER_NUMBER.test(q) || normalizePhone(q) !== null) return { kind: "valid", q };
  return { kind: "invalid" };
}

export function toOrderListParams(state: OrderFilterState): Omit<OrderListParams, "cursor"> {
  const params: Omit<OrderListParams, "cursor"> = { limit: PAGE_SIZE };
  const search = parseOrderSearch(state.search);
  if (search.kind === "valid") {
    params.q = search.q;
    return params;
  }
  if (state.status) params.status = state.status;
  else if (state.paymentStatus) params.paymentStatus = state.paymentStatus;
  return params;
}

/** True when a valid search or a chosen filter is narrowing the list. */
export function hasActiveOrderCriteria(state: OrderFilterState): boolean {
  const { q, status, paymentStatus } = toOrderListParams(state);
  return q !== undefined || status !== undefined || paymentStatus !== undefined;
}
