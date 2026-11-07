"use client";

import { Loader2 } from "lucide-react";

import { QueryErrorState } from "@/components/shared/query-error-state";
import { Button } from "@/components/ui/button";
import { countLabel } from "@/lib/list-ui";

/** The part of an infinite query's result the list view needs. */
export interface PagedQuery {
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  isRefetchError: boolean;
  hasNextPage: boolean;
  error: unknown;
  refetch: () => unknown;
  fetchNextPage: () => unknown;
}

interface PagedListViewProps<T> {
  query: PagedQuery;
  items: readonly T[];
  /** What the rows are, e.g. `{ singular: "customer", plural: "customers" }`. */
  noun: { singular: string; plural: string };
  skeleton: React.ReactNode;
  /** Shown when there are no rows (the caller picks "no match" vs "nothing yet"). */
  empty: React.ReactNode;
  /** Renders the rows (table and card list). */
  children: (items: readonly T[]) => React.ReactNode;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Body of a paginated list: aria-live count, "Updating..." hint, skeleton, error + retry, empty
 * state, the rows, a failed-refresh banner and the "Showing N ... / Load more" footer.
 */
export function PagedListView<T>({
  query,
  items,
  noun,
  skeleton,
  empty,
  children,
}: PagedListViewProps<T>) {
  const count = (n: number) => countLabel(n, noun.singular, noun.plural);
  const plural = noun.plural;
  const refreshing = query.isFetching && !query.isFetchingNextPage && !query.isPending;
  const announcement = query.isError
    ? `Could not load ${plural}`
    : query.isPending
      ? `Loading ${plural}`
      : query.isFetchingNextPage
        ? `Loading more ${plural}`
        : `${count(items.length)} shown${query.hasNextPage ? ", more available" : ""}`;

  let body: React.ReactNode;
  if (query.isPending) {
    body = skeleton;
  } else if (query.isError && items.length === 0) {
    body = (
      <QueryErrorState
        title={`${capitalize(plural)} could not be loaded`}
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  } else if (items.length === 0) {
    body = empty;
  } else {
    body = (
      <>
        {children(items)}
        {query.isFetchNextPageError || query.isRefetchError ? (
          <div className="mt-4">
            <QueryErrorState
              title={
                query.isFetchNextPageError
                  ? `More ${plural} could not be loaded`
                  : `${capitalize(plural)} could not be refreshed`
              }
              error={query.error}
              onRetry={() =>
                void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())
              }
              retrying={query.isFetching}
            />
          </div>
        ) : null}
        <div className="mt-4 flex h-9 items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            Showing {count(items.length)}
            {query.hasNextPage ? "" : " (all)"}
          </span>
          {query.hasNextPage ? (
            <Button
              variant="outline"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : null}
              {query.isFetchingNextPage ? "Loading..." : "Load more"}
            </Button>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <p
        className="mb-2 flex h-4 items-center gap-1.5 text-xs text-muted-foreground"
        aria-hidden="true"
      >
        {refreshing ? (
          <>
            <Loader2 className="size-3 animate-spin" />
            Updating...
          </>
        ) : null}
      </p>
      {body}
    </>
  );
}
