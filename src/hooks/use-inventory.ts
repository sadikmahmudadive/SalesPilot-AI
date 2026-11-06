"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { inventoryKeys, productKeys } from "@/hooks/query-keys";
import { usePagedList, type Page } from "@/hooks/use-paged-list";
import { ApiError, apiFetch } from "@/lib/api/client";
import { clean, setPaging } from "@/lib/api/query-string";
import type { AdjustInput, InventoryListItem, InventoryRecord } from "@/schemas/inventory";

/** What the UI asks for. `cursor` is added by the infinite query. */
export interface InventoryListParams {
  productId?: string;
  lowStock?: boolean;
  limit?: number;
  cursor?: string;
}

export type InventoryListPage = Page<InventoryListItem>;

/**
 * Builds the list query string. `lowStock=false` is the same as absent, and `productId` wins over
 * `lowStock=true` because the API answers 400 for the combination.
 */
export function buildInventoryQuery(params: InventoryListParams): URLSearchParams {
  const out = new URLSearchParams();
  const productId = clean(params.productId);
  if (productId) out.set("productId", productId);
  else if (params.lowStock === true) out.set("lowStock", "true");
  setPaging(out, params);
  return out;
}

export function useInventory(params: Omit<InventoryListParams, "cursor">) {
  return usePagedList<InventoryListItem, Omit<InventoryListParams, "cursor">>(
    inventoryKeys.list(params),
    "/api/inventory",
    params,
    buildInventoryQuery,
  );
}

/**
 * Whether a failed adjustment may or may not have been applied: the request never got a
 * definite answer (network failure, unreadable response) or the server failed while handling it.
 */
export function isUnconfirmedError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.code === "NETWORK" || error.code === "BAD_RESPONSE" || error.status === 0 || error.status >= 500;
}

/**
 * Adjusts stock. NOT idempotent: sending the same request twice applies the delta twice, so this
 * mutation never retries and callers must lock their submit. After an answer that leaves the
 * outcome unknown, the inventory is refetched so the screen shows the real numbers.
 */
export function useAdjustStock() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: 0,
    mutationFn: (body: AdjustInput) => apiFetch<InventoryRecord>("/api/inventory/adjust", { method: "POST", body }),
    onSuccess: (_record, { productId }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
        queryClient.invalidateQueries({ queryKey: productKeys.detail(productId) }),
      ]),
    onError: (error) => {
      if (isUnconfirmedError(error)) void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}
