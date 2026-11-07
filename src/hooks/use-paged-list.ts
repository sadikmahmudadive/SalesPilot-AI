"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  type InfiniteData,
  type QueryKey,
} from "@tanstack/react-query";

import { apiFetch } from "@/lib/api/client";

/** The shape every list endpoint answers with. */
export interface Page<TItem> {
  items: TItem[];
  nextCursor: string | null;
}

/**
 * Cursor-paginated list query shared by the customer, product and inventory screens. `queryString`
 * turns the screen's params (plus the page cursor) into the URL query, enforcing that endpoint's
 * rules. The previous rows stay on screen while a new search or filter loads.
 */
export function usePagedList<TItem, TParams extends object>(
  key: QueryKey,
  basePath: string,
  params: TParams,
  queryString: (params: TParams & { cursor?: string }) => URLSearchParams,
) {
  return useInfiniteQuery<
    Page<TItem>,
    Error,
    InfiniteData<Page<TItem>, string | undefined>,
    QueryKey,
    string | undefined
  >({
    queryKey: key,
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) => {
      const qs = queryString({ ...params, cursor: pageParam }).toString();
      return apiFetch<Page<TItem>>(qs ? `${basePath}?${qs}` : basePath, { signal });
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}
