"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus, SearchX, UserPlus, Users } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { PlaceholderCard } from "@/components/dashboard/placeholder-card";
import { CustomerFilters } from "@/components/customers/customer-filters";
import { CustomerFormDialog } from "@/components/customers/customer-form";
import { CustomerCardList, CustomerListSkeleton, CustomerTable } from "@/components/customers/customer-table";
import { DeleteCustomerDialog } from "@/components/customers/delete-customer-dialog";
import {
  DEFAULT_FILTERS,
  hasActiveCriteria,
  toListParams,
  type ListFilterState,
} from "@/components/customers/list-params";
import { QueryErrorState } from "@/components/customers/query-error-state";
import { Button } from "@/components/ui/button";
import { useCustomers } from "@/hooks/use-customers";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { can, type Role } from "@/lib/security/permissions";
import type { Customer } from "@/schemas/customer";

const SEARCH_DEBOUNCE_MS = 300;

function pluralize(count: number): string {
  return `${count} ${count === 1 ? "customer" : "customers"}`;
}

export function CustomerList({ role }: { role: Role }) {
  const canWrite = can(role, "customers:write");
  const [filters, setFilters] = useState<ListFilterState>(DEFAULT_FILTERS);
  const [form, setForm] = useState<{ open: boolean; customer?: Customer }>({ open: false });
  const [deleting, setDeleting] = useState<Customer | null>(null);

  // Typing is debounced; selects apply immediately.
  const search = useDebouncedValue(filters.search, SEARCH_DEBOUNCE_MS);
  const tag = useDebouncedValue(filters.tag, SEARCH_DEBOUNCE_MS);
  const params = useMemo(() => toListParams({ ...filters, search, tag }), [filters, search, tag]);
  const criteriaActive = hasActiveCriteria({ ...filters, search, tag });

  const query = useCustomers(params);
  const customers = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const openCreate = () => setForm({ open: true });

  const refreshing = query.isFetching && !query.isFetchingNextPage && !query.isPending;
  const announcement = query.isError
    ? "Could not load customers"
    : query.isPending
      ? "Loading customers"
      : query.isFetchingNextPage
        ? "Loading more customers"
        : `${pluralize(customers.length)} shown${query.hasNextPage ? ", more available" : ""}`;

  let body: React.ReactNode;
  if (query.isPending) {
    body = <CustomerListSkeleton />;
  } else if (query.isError && customers.length === 0) {
    body = (
      <QueryErrorState
        title="Customers could not be loaded"
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  } else if (customers.length === 0) {
    body = criteriaActive ? (
      <PlaceholderCard icon={SearchX} heading="No customers match">
        Try a different search or filter.
        <span className="mt-4 block">
          <Button variant="outline" onClick={() => setFilters(DEFAULT_FILTERS)}>
            Clear filters
          </Button>
        </span>
      </PlaceholderCard>
    ) : (
      <PlaceholderCard icon={Users} heading="No customers yet">
        {canWrite
          ? "Add your first customer to start building your CRM."
          : "Customers added by your team will appear here."}
        {canWrite ? (
          <span className="mt-4 block">
            <Button onClick={openCreate}>
              <UserPlus aria-hidden="true" />
              Add customer
            </Button>
          </span>
        ) : null}
      </PlaceholderCard>
    );
  } else {
    const table = {
      customers,
      canWrite,
      caption: `Customers, ${pluralize(customers.length)} shown`,
      onEdit: (customer: Customer) => setForm({ open: true, customer }),
      onDelete: setDeleting,
    };
    body = (
      <>
        <CustomerTable {...table} />
        <CustomerCardList {...table} />
        {query.isFetchNextPageError || query.isRefetchError ? (
          <div className="mt-4">
            <QueryErrorState
              title={
                query.isFetchNextPageError ? "More customers could not be loaded" : "Customers could not be refreshed"
              }
              error={query.error}
              onRetry={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}
              retrying={query.isFetching}
            />
          </div>
        ) : null}
        <div className="mt-4 flex h-9 items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            Showing {pluralize(customers.length)}
            {query.hasNextPage ? "" : " (all)"}
          </span>
          {query.hasNextPage ? (
            <Button variant="outline" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              {query.isFetchingNextPage ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {query.isFetchingNextPage ? "Loading..." : "Load more"}
            </Button>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Everyone you sell to, in one place. Search, filter and keep their details up to date."
        actions={
          canWrite ? (
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" />
              Add customer
            </Button>
          ) : null
        }
      />
      <CustomerFilters value={filters} onChange={setFilters} />
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <p className="mb-2 flex h-4 items-center gap-1.5 text-xs text-muted-foreground" aria-hidden="true">
        {refreshing ? (
          <>
            <Loader2 className="size-3 animate-spin" />
            Updating...
          </>
        ) : null}
      </p>
      {body}
      {canWrite ? (
        <CustomerFormDialog
          open={form.open}
          customer={form.customer}
          onOpenChange={(open) => setForm((prev) => ({ ...prev, open }))}
        />
      ) : null}
      <DeleteCustomerDialog customer={deleting} onOpenChange={(open) => !open && setDeleting(null)} />
    </div>
  );
}
