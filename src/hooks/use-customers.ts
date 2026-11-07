"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";

import { usePagedList, type Page } from "@/hooks/use-paged-list";
import { ApiError, apiFetch } from "@/lib/api/client";
import { clean, setPaging } from "@/lib/api/query-string";
import type {
  Customer,
  CustomerSegment,
  CustomerType,
  customerInputSchema,
  customerPatchSchema,
} from "@/schemas/customer";

export type CustomerSortName = "createdAt" | "fullName" | "lastInteractionAt";

/** What the UI asks for. Blank strings mean "not set". `cursor` is added by the infinite query. */
export interface CustomerListParams {
  q?: string;
  segment?: CustomerSegment | "";
  customerType?: CustomerType | "";
  tag?: string;
  assignedAgentId?: string;
  sort?: CustomerSortName;
  dir?: "asc" | "desc";
  limit?: number;
  cursor?: string;
}

export type CustomerListPage = Page<Customer>;

export type CustomerCreateBody = z.input<typeof customerInputSchema>;
export type CustomerPatchBody = z.input<typeof customerPatchSchema>;

/** Filters in priority order; the backend accepts only one of them per request. */
const FILTER_KEYS = ["segment", "customerType", "tag", "assignedAgentId"] as const;

/**
 * Builds the list query string and enforces the backend's rules client-side: empty values are
 * dropped, a search term suppresses every filter, and at most one filter is sent.
 */
export function buildCustomersQuery(params: CustomerListParams): URLSearchParams {
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
  }

  if (params.sort) out.set("sort", params.sort);
  if (params.dir) out.set("dir", params.dir);
  setPaging(out, params);
  return out;
}

export const customerKeys = {
  all: ["customers"] as const,
  lists: () => [...customerKeys.all, "list"] as const,
  list: (params: CustomerListParams) => [...customerKeys.lists(), params] as const,
  detail: (id: string) => [...customerKeys.all, "detail", id] as const,
};

export function useCustomers(params: Omit<CustomerListParams, "cursor">) {
  return usePagedList<Customer, Omit<CustomerListParams, "cursor">>(
    customerKeys.list(params),
    "/api/customers",
    params,
    buildCustomersQuery,
  );
}

export function useCustomer(id: string) {
  return useQuery({
    queryKey: customerKeys.detail(id),
    queryFn: ({ signal }) =>
      apiFetch<Customer>(`/api/customers/${encodeURIComponent(id)}`, { signal }),
    // A missing customer will not appear on retry.
    retry: (count, error) =>
      !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomerCreateBody) =>
      apiFetch<Customer>("/api/customers", { method: "POST", body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: customerKeys.all }),
  });
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CustomerPatchBody }) =>
      apiFetch<Customer>(`/api/customers/${encodeURIComponent(id)}`, { method: "PATCH", body }),
    onSuccess: (customer, { id }) => {
      queryClient.setQueryData(customerKeys.detail(id), customer);
      return queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}

export function useDeleteCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/customers/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: (_data, id) => {
      // Mark (not refetch) the detail: a profile page still on screen must not flash a 404 before it navigates away.
      void queryClient.invalidateQueries({
        queryKey: customerKeys.detail(id),
        refetchType: "none",
      });
      return queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
    },
  });
}
