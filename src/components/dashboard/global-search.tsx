"use client";

/**
 * Header search: customers, products, orders and conversations (see `GET /api/search`).
 * Ctrl/⌘ K focuses it; ↑/↓ move through the results, Enter opens the highlighted one, Esc closes.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ApiError, apiFetch } from "@/lib/api/client";
import { cn } from "@/lib/utils";

import {
  flattenHits,
  MIN_QUERY_LENGTH,
  moveIndex,
  SEARCH_GROUP_LABELS,
  SEARCH_GROUPS,
  seeAllHref,
  type SearchResultsView,
} from "./global-search-model";

const DEBOUNCE_MS = 250;

export function GlobalSearch() {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const query = useDebouncedValue(text.trim(), DEBOUNCE_MS);
  const enabled = query.length >= MIN_QUERY_LENGTH;
  const { data, isFetching, error } = useQuery({
    queryKey: ["global-search", query],
    queryFn: ({ signal }) =>
      apiFetch<SearchResultsView>(`/api/search?q=${encodeURIComponent(query)}`, { signal }),
    enabled,
    staleTime: 30_000,
  });
  const results = enabled ? data : undefined;
  const flat = useMemo(() => flattenHits(results), [results]);

  // Ctrl/⌘ K focuses the search from anywhere in the dashboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close when clicking anywhere outside the search.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const go = (href: string) => {
    close();
    setText("");
    inputRef.current?.blur();
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => moveIndex(i, e.key === "ArrowDown" ? 1 : -1, flat.length));
    } else if (e.key === "Enter") {
      const target = flat[active] ?? flat[0];
      if (target) {
        e.preventDefault();
        go(target.hit.href);
      }
    } else if (e.key === "Escape") {
      close();
      inputRef.current?.blur();
    }
  };

  const showPanel = open && text.trim().length > 0;
  const tooShort = text.trim().length < MIN_QUERY_LENGTH;
  const errorMessage = error instanceof ApiError ? error.message : error ? "Search failed" : null;
  let index = -1;

  return (
    <div ref={rootRef} className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-label="Search customers, products, orders and conversations"
        placeholder="Search"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          // Tabbing away closes it; moving focus onto a result inside the dropdown does not.
          if (!rootRef.current?.contains(e.relatedTarget as Node | null)) close();
        }}
        onKeyDown={onKeyDown}
        className="pr-14 pl-8"
        autoComplete="off"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground lg:inline">
        Ctrl K
      </kbd>

      {showPanel ? (
        <div
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {tooShort ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Type at least 2 characters.</p>
          ) : errorMessage ? (
            <p className="px-3 py-2 text-xs text-destructive">{errorMessage}</p>
          ) : !results ? (
            <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Searching…
            </p>
          ) : flat.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No matches. Names and SKUs match from the start; orders by number (SP-…) or phone.
            </p>
          ) : (
            SEARCH_GROUPS.map((group) => {
              const hits = results[group];
              if (!hits || hits.length === 0) return null;
              return (
                <div key={group} className="py-1">
                  <div className="flex items-center justify-between px-3 pb-1 text-[11px] font-medium text-muted-foreground uppercase">
                    <span>{SEARCH_GROUP_LABELS[group]}</span>
                    <Link
                      href={seeAllHref(group, query)}
                      onClick={close}
                      className="normal-case hover:text-foreground"
                    >
                      See all
                    </Link>
                  </div>
                  {hits.map((hit) => {
                    index += 1;
                    const i = index;
                    return (
                      <button
                        key={hit.id}
                        id={`${listId}-${i}`}
                        type="button"
                        role="option"
                        aria-selected={i === active}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(hit.href)}
                        className={cn(
                          "flex w-full flex-col items-start rounded-lg px-3 py-1.5 text-left text-sm",
                          i === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                        )}
                      >
                        <span className="w-full truncate font-medium">{hit.title}</span>
                        {hit.subtitle ? (
                          <span className="w-full truncate text-xs text-muted-foreground">
                            {hit.subtitle}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
          {isFetching && results ? (
            <Loader2 className="absolute top-2 right-2 size-3.5 animate-spin text-muted-foreground" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
