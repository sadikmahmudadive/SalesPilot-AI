"use client";

import { useFieldArray } from "react-hook-form";

import { TextField } from "@/components/auth/text-field";
import { errorMessageAt, type ProductFormApi } from "@/components/products/product-form-validation";
import { Repeater, RepeaterRow } from "@/components/products/repeater";
import { TextAreaField } from "@/components/shared/form-controls";
import { MAX_FAQS, MAX_SPECIFICATIONS } from "@/schemas/product";

/** Key/value rows for product specifications (up to 30). Blank rows are ignored on save. */
export function SpecsEditor({ form }: { form: ProductFormApi }) {
  const {
    control,
    register,
    watch,
    formState: { errors },
  } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "specs", keyName: "_key" });
  const rows = watch("specs");

  return (
    <Repeater
      label="Specifications"
      count={fields.length}
      max={MAX_SPECIFICATIONS}
      addLabel="Add specification"
      onAdd={() => append({ key: "", value: "" })}
      emptyText="No specifications yet. Add details such as material, weight or warranty."
      rootError={errorMessageAt(errors, "specs.root")}
      errorId="specs-root-error"
    >
      {fields.map((field, index) => {
        const name = rows?.[index]?.key?.trim();
        return (
          <RepeaterRow
            key={field._key}
            title={`Specification ${index + 1}`}
            removeLabel={`Remove specification ${name || index + 1}`}
            onRemove={() => remove(index)}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Name"
                autoComplete="off"
                placeholder="Material"
                error={errors.specs?.[index]?.key?.message}
                {...register(`specs.${index}.key`)}
              />
              <TextField
                label="Value"
                autoComplete="off"
                placeholder="Cotton"
                error={errors.specs?.[index]?.value?.message}
                {...register(`specs.${index}.value`)}
              />
            </div>
          </RepeaterRow>
        );
      })}
    </Repeater>
  );
}

/** Question/answer rows for customer-facing FAQs (up to 20). Blank rows are ignored on save. */
export function FaqsEditor({ form }: { form: ProductFormApi }) {
  const {
    control,
    register,
    formState: { errors },
  } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "faqs", keyName: "_key" });

  return (
    <Repeater
      label="FAQs"
      count={fields.length}
      max={MAX_FAQS}
      addLabel="Add FAQ"
      onAdd={() => append({ q: "", a: "" })}
      emptyText="No FAQs yet. Answers to common questions help your sales agents reply faster."
      rootError={errorMessageAt(errors, "faqs.root")}
      errorId="faqs-root-error"
    >
      {fields.map((field, index) => (
        <RepeaterRow
          key={field._key}
          title={`FAQ ${index + 1}`}
          removeLabel={`Remove FAQ ${index + 1}`}
          onRemove={() => remove(index)}
        >
          <TextField
            label="Question"
            autoComplete="off"
            error={errors.faqs?.[index]?.q?.message}
            {...register(`faqs.${index}.q`)}
          />
          <TextAreaField
            label="Answer"
            rows={3}
            error={errors.faqs?.[index]?.a?.message}
            {...register(`faqs.${index}.a`)}
          />
        </RepeaterRow>
      ))}
    </Repeater>
  );
}
