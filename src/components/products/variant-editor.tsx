"use client";

import { useState } from "react";
import { useFieldArray } from "react-hook-form";

import { errorMessageAt, type ProductFormApi } from "@/components/products/product-form-validation";
import { Repeater, RepeaterRow } from "@/components/products/repeater";
import { TextField } from "@/components/auth/text-field";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { MAX_VARIANTS } from "@/schemas/product";

const ROOT_ERROR_ID = "variants-root-error";

/**
 * Variant rows: size, color and an optional variant SKU. Rows that already exist keep their `id`
 * (it travels with the row and is sent back on save, otherwise the server treats the variant as
 * removed). Removing an existing variant asks first, because saving fails while it has stock.
 */
export function VariantEditor({ form }: { form: ProductFormApi }) {
  const {
    control,
    register,
    watch,
    formState: { errors },
  } = form;
  // keyName avoids a clash: our rows have their own `id`.
  const { fields, append, remove } = useFieldArray({ control, name: "variants", keyName: "_key" });
  const [removing, setRemoving] = useState<number | null>(null);
  const rows = watch("variants");

  const labelOf = (index: number) => {
    const row = rows?.[index];
    const parts = [row?.size, row?.color].map((v) => v?.trim()).filter(Boolean);
    return parts.length > 0 ? parts.join(" / ") : `variant ${index + 1}`;
  };

  function requestRemove(index: number) {
    if (fields[index]?.id) setRemoving(index);
    else remove(index);
  }

  return (
    <>
      <Repeater
        label="Variants"
        count={fields.length}
        max={MAX_VARIANTS}
        addLabel="Add variant"
        onAdd={() => append({ size: "", color: "", sku: "" })}
        emptyText="No variants. This product is sold as a single item with one stock count."
        rootError={errorMessageAt(errors, "variants.root")}
        errorId={ROOT_ERROR_ID}
        hint="Variants you have saved keep their stock. Removing one only works while it has no stock and no past reservations. Switching between no variants and variants also needs zero stock."
      >
        {fields.map((field, index) => (
          <RepeaterRow
            key={field._key}
            title={`Variant ${index + 1}`}
            removeLabel={`Remove ${labelOf(index)}`}
            onRemove={() => requestRemove(index)}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField
                label="Size"
                autoComplete="off"
                error={errors.variants?.[index]?.size?.message}
                {...register(`variants.${index}.size`)}
              />
              <TextField
                label="Color"
                autoComplete="off"
                error={errors.variants?.[index]?.color?.message}
                {...register(`variants.${index}.color`)}
              />
              <TextField
                label="Variant SKU (optional)"
                autoComplete="off"
                error={errors.variants?.[index]?.sku?.message}
                {...register(`variants.${index}.sku`)}
              />
            </div>
          </RepeaterRow>
        ))}
      </Repeater>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing === null ? "variant" : labelOf(removing)}?`}
        description="This variant is already saved. Saving will fail if it has stock or past reservations; set its stock to zero first in Inventory. The change only applies when you save the product."
        confirmLabel="Remove variant"
        errorFallback="Could not remove the variant."
        onConfirm={() => {
          if (removing !== null) remove(removing);
        }}
      />
    </>
  );
}
