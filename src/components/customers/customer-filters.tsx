"use client";

import { useId } from "react";
import { Search, X } from "lucide-react";

import {
  isSearchActive,
  MAX_SEARCH_LENGTH,
  MIN_SEARCH_LENGTH,
  SORT_OPTIONS,
  type FilterBy,
  type ListFilterState,
  type SortKey,
} from "@/components/customers/list-params";
import { SelectField } from "@/components/customers/form-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SEGMENT_OPTIONS, TYPE_OPTIONS } from "@/config/customer-labels";
import type { CustomerSegment, CustomerType } from "@/schemas/customer";

interface CustomerFiltersProps {
  value: ListFilterState;
  onChange: (next: ListFilterState) => void;
}

const FILTER_BY_OPTIONS: readonly { value: FilterBy; label: string }[] = [
  { value: "none", label: "None" },
  { value: "segment", label: "Segment" },
  { value: "customerType", label: "Customer type" },
  { value: "tag", label: "Tag" },
];

const SORT_SELECT_OPTIONS = SORT_OPTIONS.map((o) => ({ value: o.key, label: o.label }));

/** Search box, the single "Filter by" control with its value control, and the sort select. */
export function CustomerFilters({ value, onChange }: CustomerFiltersProps) {
  const searchId = useId();
  const hintId = useId();
  const tagId = useId();
  const searching = isSearchActive(value.search);
  const tooShort = value.search.trim().length > 0 && !searching;
  const patch = (next: Partial<ListFilterState>) => onChange({ ...value, ...next });

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 flex-1 space-y-1.5 sm:min-w-64">
          <Label htmlFor={searchId} className="text-xs text-muted-foreground">
            Search
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id={searchId}
              type="search"
              value={value.search}
              onChange={(e) => patch({ search: e.target.value })}
              placeholder="Search by name or phone"
              autoComplete="off"
              maxLength={MAX_SEARCH_LENGTH}
              aria-describedby={hintId}
              className="px-8 [&::-webkit-search-cancel-button]:appearance-none"
            />
            {value.search ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="absolute top-1/2 right-1.5 -translate-y-1/2"
                aria-label="Clear search"
                onClick={() => patch({ search: "" })}
              >
                <X aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </div>

        <SelectField
          compact
          triggerClassName="w-full sm:w-44"
          label="Filter by"
          value={value.filterBy}
          disabled={searching}
          onValueChange={(v) =>
            // Choosing a filter clears every filter value: only one can apply at a time.
            onChange({ ...value, filterBy: v as FilterBy, segment: "", customerType: "", tag: "" })
          }
          options={FILTER_BY_OPTIONS}
        />

        {value.filterBy === "segment" ? (
          <SelectField
            compact
            triggerClassName="w-full sm:w-44"
            label="Segment"
            value={value.segment}
            disabled={searching}
            placeholder="Any segment"
            onValueChange={(v) => patch({ segment: v as CustomerSegment })}
            options={SEGMENT_OPTIONS}
          />
        ) : null}
        {value.filterBy === "customerType" ? (
          <SelectField
            compact
            triggerClassName="w-full sm:w-44"
            label="Customer type"
            value={value.customerType}
            disabled={searching}
            placeholder="Any type"
            onValueChange={(v) => patch({ customerType: v as CustomerType })}
            options={TYPE_OPTIONS}
          />
        ) : null}
        {value.filterBy === "tag" ? (
          <div className="space-y-1.5">
            <Label htmlFor={tagId} className="text-xs text-muted-foreground">
              Tag
            </Label>
            <Input
              id={tagId}
              value={value.tag}
              disabled={searching}
              onChange={(e) => patch({ tag: e.target.value })}
              placeholder="e.g. vip"
              maxLength={80}
              autoComplete="off"
              className="w-full sm:w-44"
            />
          </div>
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
      </div>
      <p id={hintId} className="min-h-4 text-xs text-muted-foreground">
        {searching
          ? "Search can't be combined with filters. Results are ordered by name or phone. Clear the search to use filters and sorting."
          : tooShort
            ? `Type at least ${MIN_SEARCH_LENGTH} characters to search.`
            : "Search matches the start of a name or phone number."}
      </p>
    </div>
  );
}
