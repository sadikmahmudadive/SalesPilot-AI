"use client";

import { useId } from "react";

import { parseOrderSearch, type OrderFilterState } from "@/components/orders/order-list-params";
import { SelectField } from "@/components/shared/form-controls";
import { SearchField } from "@/components/shared/search-field";
import { ToggleButton } from "@/components/shared/toggle-button";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_OPTIONS } from "@/config/order-labels";
import type { OrderStatus, PaymentStatus } from "@/schemas/order";

interface OrderFiltersProps {
  value: OrderFilterState;
  onChange: (next: OrderFilterState) => void;
}

/** Radix Select cannot hold an empty item value, so "no payment filter" is this sentinel. */
const ANY_PAYMENT = "any";

const PILLS: readonly { status: OrderStatus | ""; label: string }[] = [
  { status: "", label: "All" },
  { status: "draft", label: "Drafts" },
  { status: "confirmed", label: ORDER_STATUS_LABELS.confirmed },
  { status: "processing", label: ORDER_STATUS_LABELS.processing },
  { status: "shipped", label: ORDER_STATUS_LABELS.shipped },
  { status: "delivered", label: ORDER_STATUS_LABELS.delivered },
  { status: "cancelled", label: ORDER_STATUS_LABELS.cancelled },
];

const PAYMENT_OPTIONS = [
  { value: ANY_PAYMENT, label: "Any payment status" },
  ...PAYMENT_STATUS_OPTIONS,
];

/**
 * Status pills, payment status select and the order-number / phone search. The API takes one
 * equality filter at a time, so choosing a status clears the payment status and vice versa, and a
 * valid search disables both.
 */
export function OrderFilters({ value, onChange }: OrderFiltersProps) {
  const hintId = useId();
  const search = parseOrderSearch(value.search);
  const searching = search.kind === "valid";

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by order status">
        {PILLS.map((pill) => {
          const pressed =
            pill.status === ""
              ? !value.status && !value.paymentStatus
              : value.status === pill.status;
          return (
            <ToggleButton
              key={pill.label}
              pressed={pressed}
              disabled={searching}
              // Pressing the active pill (or All) goes back to All.
              onPressedChange={(on) =>
                onChange({
                  ...value,
                  status: on ? pill.status : "",
                  paymentStatus: "",
                })
              }
            >
              {pill.label}
            </ToggleButton>
          );
        })}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <SearchField
          value={value.search}
          onChange={(next) => onChange({ ...value, search: next })}
          placeholder="Order number or phone"
          describedBy={hintId}
        />
        <SelectField
          compact
          triggerClassName="w-full sm:w-52"
          label="Payment status"
          value={value.paymentStatus || ANY_PAYMENT}
          disabled={searching}
          onValueChange={(v) =>
            onChange({
              ...value,
              status: "",
              paymentStatus: v === ANY_PAYMENT ? "" : (v as PaymentStatus),
            })
          }
          options={PAYMENT_OPTIONS}
        />
      </div>
      <p
        id={hintId}
        className={
          search.kind === "invalid"
            ? "min-h-4 text-xs text-destructive"
            : "min-h-4 text-xs text-muted-foreground"
        }
      >
        {search.kind === "invalid"
          ? "Enter an order number like SP-000123 or a phone number like 01712345678."
          : searching
            ? "Search can't be combined with filters. Clear the search to use them."
            : "Search by order number or customer phone. Status and payment status can't be combined."}
      </p>
    </div>
  );
}
