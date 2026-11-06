"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Boxes, Plus, SearchX } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { PlaceholderCard } from "@/components/dashboard/placeholder-card";
import {
  DEFAULT_FILTERS,
  hasActiveCriteria,
  toListParams,
  type ProductFilterState,
} from "@/components/products/list-params";
import { ProductFilters } from "@/components/products/product-filters";
import { ProductCardList, ProductTable } from "@/components/products/product-table";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PagedListView } from "@/components/shared/paged-list";
import { Button } from "@/components/ui/button";
import { useCategories } from "@/hooks/use-categories";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useProducts } from "@/hooks/use-products";
import { countLabel } from "@/lib/list-ui";
import { can, type Role } from "@/lib/security/permissions";

const SEARCH_DEBOUNCE_MS = 300;
const NOUN = { singular: "product", plural: "products" };

function AddProductButton() {
  return (
    <Button asChild>
      <Link href="/products/new">
        <Plus aria-hidden="true" />
        Add product
      </Link>
    </Button>
  );
}

export function ProductList({ role }: { role: Role }) {
  const canWrite = can(role, "products:write");
  const [filters, setFilters] = useState<ProductFilterState>(DEFAULT_FILTERS);

  // Typing is debounced; selects and toggles apply immediately.
  const search = useDebouncedValue(filters.search, SEARCH_DEBOUNCE_MS);
  const effective = useMemo(() => ({ ...filters, search }), [filters, search]);
  const params = useMemo(() => toListParams(effective), [effective]);
  const criteriaActive = hasActiveCriteria(effective);

  const query = useProducts(params);
  const categories = useCategories();
  const products = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const categoryNames = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c.name])), [categories.data]);

  const empty = criteriaActive ? (
    <PlaceholderCard icon={SearchX} heading={filters.archived && !search ? "No archived products" : "No products match"}>
      {filters.archived && !search
        ? "Archived products appear here. Turn off the archived view to see your catalogue."
        : "Try a different search or filter."}
      <span className="mt-4 block">
        <Button variant="outline" onClick={() => setFilters(DEFAULT_FILTERS)}>
          Clear filters
        </Button>
      </span>
    </PlaceholderCard>
  ) : (
    <PlaceholderCard icon={Boxes} heading="No products yet">
      {canWrite
        ? "Add your first product to start building your catalogue."
        : "Products added by your team will appear here."}
      {canWrite ? (
        <span className="mt-4 block">
          <AddProductButton />
        </span>
      ) : null}
    </PlaceholderCard>
  );

  return (
    <div>
      <PageHeader
        title="Products"
        description="Your catalogue: prices, variants and availability. Search by name or SKU, or filter by category."
        actions={canWrite ? <AddProductButton /> : null}
      />
      <ProductFilters value={filters} onChange={setFilters} categories={categories.data} />
      <PagedListView query={query} items={products} noun={NOUN} skeleton={<ListSkeleton />} empty={empty}>
        {(rows) => {
          const table = {
            products: rows,
            categoryNames,
            canWrite,
            caption: `Products, ${countLabel(rows.length, "product")} shown`,
          };
          return (
            <>
              <ProductTable {...table} />
              <ProductCardList {...table} />
            </>
          );
        }}
      </PagedListView>
    </div>
  );
}
