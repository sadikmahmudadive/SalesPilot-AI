"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";

import { usePagedList, type Page } from "@/hooks/use-paged-list";
import { ApiError, apiFetch } from "@/lib/api/client";
import { clean, setPaging } from "@/lib/api/query-string";
import type {
  Order,
  OrderEvent,
  OrderSettings,
  OrderStatus,
  PaymentStatus,
  orderCreateSchema,
  orderDraftPatchSchema,
  orderSettingsSchema,
} from "@/schemas/order";
import type { OrderAction } from "@/services/orders/state-machine";

/** What the UI asks for. Blank strings mean "not set". `cursor` is added by the infinite query. */
export interface OrderListParams {
  status?: OrderStatus | "";
  paymentStatus?: PaymentStatus | "";
  q?: string;
  customerId?: string;
  /** Full ISO datetimes with an offset. */
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export type OrderListPage = Page<Order>;
/** The detail endpoint adds whether the hold has run out. */
export type OrderDetail = Order & { expired: boolean };

export type OrderCreateBody = z.input<typeof orderCreateSchema>;
export type OrderDraftPatchBody = z.input<typeof orderDraftPatchSchema>;
export type OrderSettingsPatchBody = Partial<z.input<typeof orderSettingsSchema>>;

/** Actions with a route. `expire` is only ever run by the hold sweep. */
export type OrderHttpAction = Exclude<OrderAction, "expire">;
/**
 * What a lifecycle action needs, checked at compile time: `cancel` and `refund` always carry a
 * reason; `process` may carry the override reason for an unpaid online order; the rest carry nothing.
 */
export type OrderActionInput =
  | { action: "cancel" | "refund"; body: { reason: string } }
  | { action: "process"; body?: { allowUnpaidReason?: string } }
  | { action: "confirm" | "ship" | "deliver" | "return"; body?: undefined };

/** The JSON body an action sends (`undefined` means no body). `process` always sends an object. */
export function actionRequest(action: OrderHttpAction, body?: object): object | undefined {
  if (action === "process") return body ?? {};
  if (action === "cancel" || action === "refund") return body;
  return undefined;
}

/** The backend accepts one equality filter at a time (with the date range); the first one set wins. */
const FILTER_KEYS = ["status", "paymentStatus", "customerId"] as const;

/**
 * Builds the list query and enforces the backend's rules client-side: blank values are dropped,
 * a search term (order number or phone) suppresses every other filter, and at most one equality
 * filter is sent.
 */
export function buildOrdersQuery(params: OrderListParams): URLSearchParams {
  const out = new URLSearchParams();
  const q = clean(params.q);

  if (q) out.set("q", q);
  else {
    for (const key of FILTER_KEYS) {
      const value = clean(params[key]);
      if (value) {
        out.set(key, value);
        break;
      }
    }
    for (const key of ["from", "to"] as const) {
      const value = clean(params[key]);
      if (value) out.set(key, value);
    }
  }

  setPaging(out, params);
  return out;
}

export function orderListQueryString(params: OrderListParams): string {
  return buildOrdersQuery(params).toString();
}

export const orderKeys = {
  all: ["orders"] as const,
  list: (params: OrderListParams) => [...orderKeys.all, params] as const,
  detail: (id: string) => [...orderKeys.all, id] as const,
  events: (id: string) => [...orderKeys.all, id, "events"] as const,
  customer: (customerId: string) => [...orderKeys.all, "customer", customerId] as const,
  settings: ["order-settings"] as const,
};

const orderPath = (id: string) => `/api/orders/${encodeURIComponent(id)}`;

/** A missing order will not appear on retry. */
const retryUnlessClientError = (count: number, error: unknown) =>
  !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1;

export function useOrderList(params: Omit<OrderListParams, "cursor">) {
  return usePagedList<Order, Omit<OrderListParams, "cursor">>(
    orderKeys.list(params),
    "/api/orders",
    params,
    buildOrdersQuery,
  );
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: orderKeys.detail(id),
    queryFn: ({ signal }) => apiFetch<OrderDetail>(orderPath(id), { signal }),
    retry: retryUnlessClientError,
  });
}

/** A customer's 5 newest orders (the inbox sidebar). Refreshed with every other order query. */
export function useCustomerOrders(customerId: string | null) {
  return useQuery({
    queryKey: orderKeys.customer(customerId ?? ""),
    queryFn: ({ signal }) =>
      apiFetch<{ items: Order[] }>(
        `/api/customers/${encodeURIComponent(customerId ?? "")}/orders`,
        {
          signal,
        },
      ),
    enabled: customerId !== null,
    retry: retryUnlessClientError,
  });
}

export function useOrderEvents(id: string) {
  return useQuery({
    queryKey: orderKeys.events(id),
    queryFn: ({ signal }) =>
      apiFetch<{ items: OrderEvent[] }>(`${orderPath(id)}/events`, { signal }),
    retry: retryUnlessClientError,
  });
}

/** Runs a lifecycle action, then refreshes every order query (list, detail, events). */
export function useOrderAction(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, body }: OrderActionInput) =>
      apiFetch<Order>(`${orderPath(id)}/${action}`, {
        method: "POST",
        body: actionRequest(action, body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKeys.all }),
  });
}

export function useCreateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: OrderCreateBody) => apiFetch<Order>("/api/orders", { method: "POST", body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKeys.all }),
  });
}

export function useUpdateDraft(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: OrderDraftPatchBody) =>
      apiFetch<Order>(orderPath(id), { method: "PATCH", body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKeys.all }),
  });
}

export function useOrderSettings() {
  return useQuery({
    queryKey: orderKeys.settings,
    queryFn: ({ signal }) => apiFetch<OrderSettings>("/api/settings/orders", { signal }),
  });
}

export function useUpdateOrderSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: OrderSettingsPatchBody) =>
      apiFetch<OrderSettings>("/api/settings/orders", { method: "PATCH", body }),
    onSuccess: (settings) => queryClient.setQueryData(orderKeys.settings, settings),
  });
}
