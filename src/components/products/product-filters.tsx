"use client";

import { useId } from "react";

import {
  SORT_OPTIONS,
  type FilterBy,
  type ProductFilterState,
  type SearchMode,
  type SortKey,
} from "@/components/products/list-params";
import { SelectField } from "@/components/shared/form-controls";
import { SearchField } from "@/components/shared/search-field";
import { ToggleButton } from "@/components/shared/toggle-button";
import { LIVE_AVAILABILITY_OPTIONS } from "@/config/product-labels";
import { isSearchActive, MIN_SEARCH_LENGTH } from "@/lib/list-ui";
import type { Category } from "@/schemas/product";

interface ProductFiltersProps {
  value: ProductFilterState;
  onChange: (next: ProductFilterState) => void;
  categories: readonly Category[] | undefined;
}

const SEARCH_MODE_OPTIONS: readonly { value: SearchMode; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "sku", label: "SKU" },
];

const FILTER_BY_OPTIONS: readonly { value: FilterBy; label: string }[] = [
  { value: "none", label: "None" },
  { value: "availability", label: "Availability" },
  { value: "category", label: "Category" },
];

const SORT_SELECT_OPTIONS = SORT_OPTIONS.map((o) => ({ value: o.key, label: o.label }));

/** Search (by name or SKU), the single "Filter by" control with its value, sort, and the archived toggle. */
export function ProductFilters({ value, onChange, categories }: ProductFiltersProps) {
  const hintId = useId();
  const searching = isSearchActive(value.search);
  const tooShort = value.search.trim().length > 0 && !searching;
  const patch = (next: Partial<ProductFilterState>) => onChange({ ...value, ...next });
  const categoryOptions = (categories ?? []).map((c) => ({ value: c.id, label: c.name }));

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <SearchField
          value={value.search}
          onChange={(search) => patch({ search })}
          placeholder={value.searchMode === "sku" ? "Search by SKU" : "Search by product name"}
          describedBy={hintId}
        />
        <SelectField
          compact
          triggerClassName="w-full sm:w-28"
          label="Search by"
          value={value.searchMode}
          onValueChange={(v) => patch({ searchMode: v as SearchMode })}
          options={SEARCH_MODE_OPTIONS}
        />

        <SelectField
          compact
          triggerClassName="w-full sm:w-40"
          label="Filter by"
          value={value.filterBy}
          disabled={searching}
          onValueChange={(v) =>
            // Choosing a filter clears every filter value: only one can apply at a time.
            onChange({ ...value, filterBy: v as FilterBy, availability: "", categoryId: "" })
          }
          options={FILTER_BY_OPTIONS}
        />
        {value.filterBy === "availability" ? (
          <SelectField
            compact
            triggerClassName="w-full sm:w-40"
            label="Availability"
            value={value.availability}
            disabled={searching || value.archived}
            placeholder="Any availability"
            onValueChange={(v) => patch({ availability: v as ProductFilterState["availability"] })}
            options={LIVE_AVAILABILITY_OPTIONS}
          />
        ) : null}
        {value.filterBy === "category" ? (
          <SelectField
            compact
            triggerClassName="w-full sm:w-44"
            label="Category"
            value={value.categoryId}
            disabled={searching || categories === undefined}
            placeholder={categories === undefined ? "Loading categories..." : "Any category"}
            onValueChange={(v) => patch({ categoryId: v })}
            options={categoryOptions}
          />
        ) : null}

        <SelectField
          compact
          triggerClassName="w-full sm:w-44"
          label="Sort by"
          value={value.sortKey}
          disabled={searching}
          onValueChange={(v) => patch({ sortKey: v as SortKey })}
          options={SORT_SELECT_OPTIONS}
        />
        <ToggleButton pressed={value.archived} onPressedChange={(archived) => patch({ archived })}>
          Archived products
        </ToggleButton>
      </div>
      <p id={hintId} className="min-h-4 text-xs text-muted-foreground">
        {searching
          ? "Search can't be combined with filters. Results are ordered by the searched field. Clear the search to use filters and sorting."
          : tooShort
            ? `Type at least ${MIN_SEARCH_LENGTH} characters to search.`
            : value.archived && value.filterBy === "availability"
              ? "Archived products are all archived, so the availability filter does not apply."
              : "Search matches the start of a product name or SKU."}
      </p>
    </div>
  );
}
