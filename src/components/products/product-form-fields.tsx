"use client";

import { Controller } from "react-hook-form";

import { TextField } from "@/components/auth/text-field";
import { CategorySelect } from "@/components/products/category-select";
import type { ProductFormApi } from "@/components/products/product-form-validation";
import { SelectField, TextAreaField } from "@/components/shared/form-controls";
import { AVAILABILITY_OPTIONS, LIVE_AVAILABILITY_OPTIONS } from "@/config/product-labels";

/** Name, SKU, description and category. */
export function BasicsFields({ form, canWrite }: { form: ProductFormApi; canWrite: boolean }) {
  const {
    register,
    formState: { errors },
  } = form;
  return (
    <div className="space-y-4">
      <TextField
        label="Product name"
        autoComplete="off"
        error={errors.name?.message}
        {...register("name")}
      />
      <TextField
        label="SKU"
        autoComplete="off"
        placeholder="SHIRT-001"
        error={errors.sku?.message}
        {...register("sku")}
      />
      <TextAreaField
        label="Description (optional)"
        rows={4}
        error={errors.description?.message}
        {...register("description")}
      />
      <CategorySelect form={form} canWrite={canWrite} />
    </div>
  );
}

/** Regular, sale and wholesale prices, typed in taka. */
export function PricingFields({ form }: { form: ProductFormApi }) {
  const {
    register,
    formState: { errors },
  } = form;
  const money = { inputMode: "decimal", autoComplete: "off", placeholder: "0.00" } as const;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <TextField
        label="Regular price (BDT)"
        error={errors.regularPrice?.message}
        {...money}
        {...register("regularPrice")}
      />
      <TextField
        label="Sale price (BDT, optional)"
        error={errors.salePrice?.message}
        {...money}
        {...register("salePrice")}
      />
      <TextField
        label="Wholesale price (BDT, optional)"
        error={errors.wholesalePrice?.message}
        {...money}
        {...register("wholesalePrice")}
      />
    </div>
  );
}

interface AvailabilityFieldProps {
  form: ProductFormApi;
  /** An archived product offers "Archived" too, so its current value is shown. */
  archived: boolean;
}

export function AvailabilityField({ form, archived }: AvailabilityFieldProps) {
  const {
    control,
    formState: { errors },
  } = form;
  return (
    <Controller
      control={control}
      name="availability"
      render={({ field }) => (
        <SelectField
          label="Availability"
          value={field.value}
          onValueChange={field.onChange}
          options={archived ? AVAILABILITY_OPTIONS : LIVE_AVAILABILITY_OPTIONS}
          error={errors.availability?.message}
        />
      )}
    />
  );
}
