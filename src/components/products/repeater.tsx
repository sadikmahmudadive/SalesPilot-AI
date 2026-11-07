"use client";

import { Plus, Trash2 } from "lucide-react";

import { FieldError } from "@/components/shared/form-controls";
import { Button } from "@/components/ui/button";

interface RepeaterProps {
  /** Accessible name of the list, e.g. "Variants". */
  label: string;
  count: number;
  max: number;
  addLabel: string;
  onAdd: () => void;
  /** Shown instead of the list when there are no rows. */
  emptyText: string;
  /** Message about the list as a whole (too many rows, duplicates). */
  rootError?: string;
  /** Id for the root error element. */
  errorId: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}

/** Shell shared by the variant, specification and FAQ editors: the list, the add button and the list-level error. */
export function Repeater({
  label,
  count,
  max,
  addLabel,
  onAdd,
  emptyText,
  rootError,
  errorId,
  hint,
  children,
}: RepeaterProps) {
  const full = count >= max;
  return (
    <div className="space-y-4">
      {count === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <ul className="space-y-3" aria-label={label}>
          {children}
        </ul>
      )}
      <FieldError id={errorId} message={rootError} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={onAdd} disabled={full}>
          <Plus aria-hidden="true" />
          {addLabel}
        </Button>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {count} of {max}
        </span>
      </div>
    </div>
  );
}

/** One row of a repeater: a bordered item with a title and a remove button that names the row. */
export function RepeaterRow({
  title,
  removeLabel,
  onRemove,
  children,
}: {
  title: string;
  removeLabel: string;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <li>
      <fieldset className="space-y-3 rounded-lg border p-3 sm:p-4">
        <legend className="sr-only">{title}</legend>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground" aria-hidden="true">
            {title}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            aria-label={removeLabel}
            onClick={onRemove}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
        {children}
      </fieldset>
    </li>
  );
}
