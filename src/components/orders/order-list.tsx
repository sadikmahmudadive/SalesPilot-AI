"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, SearchX, ShoppingCart } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { PlaceholderCard } from "@/components/dashboard/placeholder-card";
import { OrderFilters } from "@/components/orders/order-filters";
import {
  DEFAULT_ORDER_FILTERS,
  hasActiveOrderCriteria,
  parseOrderSearch,
  toOrderListParams,
  type OrderFilterState,
} from "@/components/orders/order-list-params";
import { OrderCardList, OrderTable } from "@/components/orders/order-table";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PagedListView } from "@/components/shared/paged-list";
import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useOrderList } from "@/hooks/use-orders";
import { countLabel } from "@/lib/list-ui";
import { can, type Role } from "@/lib/security/permissions";

const SEARCH_DEBOUNCE_MS = 300;

const NOUN = { singular: "order", plural: "orders" };

export function OrderList({ role }: { role: Role }) {
  const canWrite = can(role, "orders:write");
  const [filters, setFilters] = useState<OrderFilterState>(DEFAULT_ORDER_FILTERS);

  // Typing is debounced; pills and the select apply immediately. An invalid search sends no
  // request: the list stays as the filters alone describe it.
  const search = useDebouncedValue(filters.search, SEARCH_DEBOUNCE_MS);
  const applied = useMemo(() => ({ ...filters, search }), [filters, search]);
  const params = useMemo(() => toOrderListParams(applied), [applied]);
  const criteriaActive = hasActiveOrderCriteria(applied);

  const query = useOrderList(params);
  const orders = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  // The Expired badge is judged at the moment the rows were fetched (pure; a refetch updates it).
  const now = query.dataUpdatedAt;

  const newOrder = canWrite ? (
    <Button asChild>
      <Link href="/orders/new">
        <Plus aria-hidden="true" />
        New order
      </Link>
    </Button>
  ) : null;

  const empty = criteriaActive ? (
    <PlaceholderCard icon={SearchX} heading="No orders match">
      {parseOrderSearch(applied.search).kind === "valid"
        ? "No order matches that order number or phone."
        : "Try a different status or payment filter."}
      <span className="mt-4 block">
        <Button variant="outline" onClick={() => setFilters(DEFAULT_ORDER_FILTERS)}>
          Clear filters
        </Button>
      </span>
    </PlaceholderCard>
  ) : (
    <PlaceholderCard icon={ShoppingCart} heading="No orders yet">
      {canWrite
        ? "Orders from your AI agents and your team will appear here. Create one to get started."
        : "Orders created by your AI agents and team will appear here."}
      {newOrder ? <span className="mt-4 block">{newOrder}</span> : null}
    </PlaceholderCard>
  );

  return (
    <div>
      <PageHeader
        title="Orders"
        description="Every order from request to delivery. Filter by status or payment, or look one up by order number or phone."
        actions={newOrder}
      />
      <OrderFilters value={filters} onChange={setFilters} />
      <PagedListView
        query={query}
        items={orders}
        noun={NOUN}
        skeleton={<ListSkeleton />}
        empty={empty}
      >
        {(rows) => {
          const table = {
            orders: rows,
            now,
            caption: `Orders, ${countLabel(rows.length, "order")} shown`,
          };
          return (
            <>
              <OrderTable {...table} />
              <OrderCardList {...table} />
            </>
          );
        }}
      </PagedListView>
    </div>
  );
}
