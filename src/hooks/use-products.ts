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

import { inventoryKeys, productKeys } from "@/hooks/query-keys";
import { ApiError, apiFetch } from "@/lib/api/client";
import type { Availability, Product, productInputSchema, productPatchSchema } from "@/schemas/product";

export type ProductSortName = "createdAt" | "name" | "updatedAt";

/** What the UI asks for. Blank strings mean "not set". `cursor` is added by the infinite query. */
export interface ProductListParams {
  /** Name prefix search. */
  q?: string;
  /** SKU prefix search. */
  sku?: string;
  availability?: Availability | "";
  categoryId?: string;
  /** Show archived products instead of the live ones. */
  archived?: boolean;
  sort?: ProductSortName;
  dir?: "asc" | "desc";
  limit?: number;
  cursor?: string;
}

export interface ProductListPage {
  items: Product[];
  nextCursor: string | null;
}

export type ProductCreateBody = z.input<typeof productInputSchema>;
export type ProductPatchBody = z.input<typeof productPatchSchema>;

/** Filters in priority order; the backend accepts only one of them per request. */
const FILTER_KEYS = ["availability", "categoryId"] as const;

const clean = (v: string | undefined): string => (typeof v === "string" ? v.trim() : "");

/**
 * Builds the list query string and enforces the backend's rules client-side: empty values are
 * dropped; a name search wins over a SKU search; either search suppresses every filter and the
 * sort (the API orders searches by the searched field); otherwise at most one filter is sent.
 * `archived` is not a filter: it is sent (as `true`) alongside anything.
 */
export function buildProductsQuery(params: ProductListParams): URLSearchParams {
  const out = new URLSearchParams();
  const q = clean(params.q);
  const sku = clean(params.sku);
  const searching = q.length > 0 || sku.length > 0;

  if (q) out.set("q", q);
  else if (sku) out.set("sku", sku);
  else {
    for (const key of FILTER_KEYS) {
      const value = clean(params[key]);
      if (value) {
        out.set(key, value);
        break;
      }
    }
  }

  if (params.archived === true) out.set("archived", "true");
  if (!searching) {
    if (params.sort) out.set("sort", params.sort);
    if (params.dir) out.set("dir", params.dir);
  }
  if (typeof params.limit === "number" && params.limit > 0) out.set("limit", String(params.limit));
  const cursor = clean(params.cursor);
  if (cursor) out.set("cursor", cursor);
  return out;
}

function listPath(params: ProductListParams): string {
  const qs = buildProductsQuery(params).toString();
  return qs ? `/api/products?${qs}` : "/api/products";
}

export function useProducts(params: Omit<ProductListParams, "cursor">) {
  return useInfiniteQuery<
    ProductListPage,
    Error,
    InfiniteData<ProductListPage, string | undefined>,
    ReturnType<typeof productKeys.list>,
    string | undefined
  >({
    queryKey: productKeys.list(params),
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch<ProductListPage>(listPath({ ...params, cursor: pageParam }), { signal }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData, // keep showing the old rows while a new search/filter loads
  });
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: productKeys.detail(id),
    queryFn: ({ signal }) => apiFetch<Product>(`/api/products/${encodeURIComponent(id)}`, { signal }),
    // A missing product will not appear on retry.
    retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ProductCreateBody) => apiFetch<Product>("/api/products", { method: "POST", body }),
    onSuccess: (product) => {
      queryClient.setQueryData(productKeys.detail(product.id), product);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: productKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
      ]);
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ProductPatchBody }) =>
      apiFetch<Product>(`/api/products/${encodeURIComponent(id)}`, { method: "PATCH", body }),
    onSuccess: (product, { id }) => {
      queryClient.setQueryData(productKeys.detail(id), product);
      // Inventory rows carry the product name, SKU and variant labels.
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: productKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
      ]);
    },
  });
}

/** DELETE archives (soft delete): the product stays readable and can be restored. */
export function useArchiveProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<Product>(`/api/products/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: (product, id) => {
      queryClient.setQueryData(productKeys.detail(id), product);
      return queryClient.invalidateQueries({ queryKey: productKeys.lists() });
    },
  });
}
