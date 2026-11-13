"use client";

import { useState } from "react";

import { TextField } from "@/components/auth/text-field";
import { Button } from "@/components/ui/button";
import { useCustomers } from "@/hooks/use-customers";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { Customer } from "@/schemas/customer";

const SEARCH_DEBOUNCE_MS = 300;
const RESULT_LIMIT = 8;

interface CustomerPickerProps {
  /** The chosen customer, or null. */
  value: Pick<Customer, "id" | "fullName" | "phone"> | null;
  onChange: (customer: Customer | null) => void;
  error?: string;
  disabled?: boolean;
}

/** Search the CRM by name or phone and pick one customer; the chosen one is shown with a Change button. */
export function CustomerPicker({ value, onChange, error, disabled }: CustomerPickerProps) {
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const query = useCustomers({ q, limit: RESULT_LIMIT });
  const results = query.data?.pages.flatMap((p) => p.items) ?? [];

  if (value) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{value.fullName}</p>
          <p className="text-xs text-muted-foreground tabular-nums">{value.phone}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => {
            setSearch("");
            onChange(null);
          }}
        >
          Change
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <TextField
        label="Find a customer"
        placeholder="Search by name or phone"
        autoComplete="off"
        value={search}
        disabled={disabled}
        onChange={(e) => setSearch(e.target.value)}
        error={error}
      />
      <div aria-live="polite" className="text-sm">
        {query.isPending ? (
          <p className="text-muted-foreground">Loading customers…</p>
        ) : query.isError ? (
          <p className="text-destructive">Customers could not be loaded. Try searching again.</p>
        ) : results.length === 0 ? (
          <p className="text-muted-foreground">
            {q
              ? "No customer matches that search."
              : "No customers yet. Add one from Customers first."}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(c)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none disabled:opacity-50"
                >
                  <span className="truncate font-medium">{c.fullName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {c.phone}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
