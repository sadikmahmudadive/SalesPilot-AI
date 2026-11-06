"use client";

import { useId } from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_SEARCH_LENGTH } from "@/lib/list-ui";

interface SearchFieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Id of the element that explains the search rules. */
  describedBy?: string;
}

/** Labelled search box with a magnifier and a "Clear search" button. Debouncing is the caller's job. */
export function SearchField({ label = "Search", value, onChange, placeholder, describedBy }: SearchFieldProps) {
  const id = useId();
  return (
    <div className="min-w-0 flex-1 space-y-1.5 sm:min-w-64">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={id}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          maxLength={MAX_SEARCH_LENGTH}
          aria-describedby={describedBy}
          className="px-8 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute top-1/2 right-1.5 -translate-y-1/2"
            aria-label="Clear search"
            onClick={() => onChange("")}
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
