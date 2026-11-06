"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import type { z } from "zod";

import { ApiError, apiFetch } from "@/lib/api/client";
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

export interface CustomerListPage {
  items: Customer[];
  nextCursor: string | null;
}

export type CustomerCreateBody = z.input<typeof customerInputSchema>;
export type CustomerPatchBody = z.input<typeof customerPatchSchema>;

/** Filters in priority order; the backend accepts only one of them per request. */
const FILTER_KEYS = ["segment", "customerType", "tag", "assignedAgentId"] as const;

const clean = (v: string | undefined): string => (typeof v === "string" ? v.trim() : "");

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
  if (typeof params.limit === "number" && params.limit > 0) out.set("limit", String(params.limit));
  const cursor = clean(params.cursor);
  if (cursor) out.set("cursor", cursor);
  return out;
}

export const customerKeys = {
  all: ["customers"] as const,
  lists: () => [...customerKeys.all, "list"] as const,
  list: (params: CustomerListParams) => [...customerKeys.lists(), params] as const,
  detail: (id: string) => [...customerKeys.all, "detail", id] as const,
};

function listPath(params: CustomerListParams): string {
  const qs = buildCustomersQuery(params).toString();
  return qs ? `/api/customers?${qs}` : "/api/customers";
}

export function useCustomers(params: Omit<CustomerListParams, "cursor">) {
  return useInfiniteQuery<
    CustomerListPage,
    Error,
    InfiniteData<CustomerListPage, string | undefined>,
    ReturnType<typeof customerKeys.list>,
    string | undefined
  >({
    queryKey: customerKeys.list(params),
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch<CustomerListPage>(listPath({ ...params, cursor: pageParam }), { signal }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData, // keep showing the old rows while a new search/filter loads
  });
}

export function useCustomer(id: string) {
  return useQuery({
    queryKey: customerKeys.detail(id),
    queryFn: ({ signal }) => apiFetch<Customer>(`/api/customers/${encodeURIComponent(id)}`, { signal }),
    // A missing customer will not appear on retry.
    retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomerCreateBody) => apiFetch<Customer>("/api/customers", { method: "POST", body }),
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
    mutationFn: (id: string) => apiFetch<void>(`/api/customers/${encodeURIComponent(id)}`, { method: "DELETE" }),
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
