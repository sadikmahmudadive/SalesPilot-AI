"use client";

import { useId } from "react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

interface SelectFieldProps {
  label: string;
  value: string | undefined;
  onValueChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  /** Compact filter-bar look: small muted label, tighter spacing. */
  compact?: boolean;
  /** Width classes for the trigger (defaults to full width). */
  triggerClassName?: string;
}

/**
 * Labelled shadcn Select with an inline error, wired for `aria-invalid` / `aria-describedby`.
 * Controlled (`value` + `onValueChange`), so it works directly with a react-hook-form
 * `Controller` (`value={field.value} onValueChange={field.onChange}`) and with plain state.
 */
export function SelectField({
  label,
  value,
  onValueChange,
  options,
  placeholder,
  error,
  disabled,
  compact = false,
  triggerClassName = "w-full",
}: SelectFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      <Label htmlFor={id} className={compact ? "text-xs text-muted-foreground" : undefined}>
        {label}
      </Label>
      <Select value={value ?? ""} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger
          id={id}
          className={triggerClassName}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError id={errorId} message={error} />
    </div>
  );
}

type TextAreaFieldProps = Omit<React.ComponentProps<"textarea">, "id"> & {
  label: string;
  error?: string;
};

export function TextAreaField({ label, error, ...props }: TextAreaFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...props}
      />
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 border-t pt-5 first:border-t-0 first:pt-0">
      <legend className="mb-3 text-sm font-medium">{title}</legend>
      {children}
    </fieldset>
  );
}
