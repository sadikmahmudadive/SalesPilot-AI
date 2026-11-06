"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Controller } from "react-hook-form";

import { NewCategoryDialog } from "@/components/products/new-category-dialog";
import type { ProductFormApi } from "@/components/products/product-form-validation";
import { SelectField } from "@/components/shared/form-controls";
import { Button } from "@/components/ui/button";
import { useCategories } from "@/hooks/use-categories";

const NONE = "none";

interface CategorySelectProps {
  form: ProductFormApi;
  /** Writers can add a category from here. */
  canWrite: boolean;
}

/** Category dropdown for the product form, with an inline "New category" dialog for writers. */
export function CategorySelect({ form, canWrite }: CategorySelectProps) {
  const categories = useCategories();
  const [creating, setCreating] = useState(false);
  const {
    control,
    setValue,
    formState: { errors },
  } = form;

  return (
    <div className="space-y-2">
      <Controller
        control={control}
        name="categoryId"
        render={({ field }) => {
          const current = field.value;
          const options = [
            { value: NONE, label: "No category" },
            ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
          ];
          // Keep the product's own category selectable even if the list did not include it.
          if (current && !options.some((o) => o.value === current) && categories.data) {
            options.push({ value: current, label: "Unknown category" });
          }
          return (
            <SelectField
              label="Category (optional)"
              value={current || NONE}
              onValueChange={(v) => field.onChange(v === NONE ? "" : v)}
              options={options}
              placeholder={categories.isPending ? "Loading categories..." : undefined}
              error={errors.categoryId?.message}
              disabled={categories.isPending && !current}
            />
          );
        }}
      />
      {categories.isError ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-destructive" role="alert">
          Categories could not be loaded.
          <Button type="button" variant="link" size="xs" onClick={() => void categories.refetch()}>
            Try again
          </Button>
        </p>
      ) : null}
      {canWrite ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" />
          New category
        </Button>
      ) : null}
      {canWrite ? (
        <NewCategoryDialog
          open={creating}
          onOpenChange={setCreating}
          onCreated={(category) => setValue("categoryId", category.id, { shouldDirty: true, shouldValidate: false })}
        />
      ) : null}
    </div>
  );
}
