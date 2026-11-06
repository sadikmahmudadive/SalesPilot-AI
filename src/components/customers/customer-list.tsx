"use client";

import { useMemo, useState } from "react";
import { Plus, SearchX, UserPlus, Users } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { PlaceholderCard } from "@/components/dashboard/placeholder-card";
import { CustomerFilters } from "@/components/customers/customer-filters";
import { CustomerFormDialog } from "@/components/customers/customer-form";
import { CustomerCardList, CustomerTable } from "@/components/customers/customer-table";
import { DeleteCustomerDialog } from "@/components/customers/delete-customer-dialog";
import {
  DEFAULT_FILTERS,
  hasActiveCriteria,
  toListParams,
  type ListFilterState,
} from "@/components/customers/list-params";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PagedListView } from "@/components/shared/paged-list";
import { Button } from "@/components/ui/button";
import { useCustomers } from "@/hooks/use-customers";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { countLabel } from "@/lib/list-ui";
import { can, type Role } from "@/lib/security/permissions";
import type { Customer } from "@/schemas/customer";

const SEARCH_DEBOUNCE_MS = 300;

const NOUN = { singular: "customer", plural: "customers" };

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

  const empty = criteriaActive ? (
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
      <PagedListView
        query={query}
        items={customers}
        noun={NOUN}
        skeleton={<ListSkeleton />}
        empty={empty}
      >
        {(rows) => {
          const table = {
            customers: rows,
            canWrite,
            caption: `Customers, ${countLabel(rows.length, "customer")} shown`,
            onEdit: (customer: Customer) => setForm({ open: true, customer }),
            onDelete: setDeleting,
          };
          return (
            <>
              <CustomerTable {...table} />
              <CustomerCardList {...table} />
            </>
          );
        }}
      </PagedListView>
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
