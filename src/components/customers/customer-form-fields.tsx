"use client";

import { Controller, type UseFormReturn } from "react-hook-form";
import type { z } from "zod";

import { TextField } from "@/components/auth/text-field";
import { tagsErrorMessage, type CustomerFormValues } from "@/components/customers/customer-form-model";
import { FieldError, FormSection, SelectField, TextAreaField } from "@/components/customers/form-controls";
import { TagInput } from "@/components/customers/tag-input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CONSENT_LABELS, LANGUAGE_LABELS, SEGMENT_OPTIONS, TYPE_OPTIONS } from "@/config/customer-labels";
import { CONSENT_STATUSES, type customerInputSchema } from "@/schemas/customer";

export type CustomerForm = UseFormReturn<CustomerFormValues, unknown, z.output<typeof customerInputSchema>>;

const LANGUAGE_NOT_SET = "none";
const LANGUAGE_OPTIONS = [
  { value: LANGUAGE_NOT_SET, label: "Not set" },
  ...Object.entries(LANGUAGE_LABELS).map(([value, label]) => ({ value, label })),
];

export function CustomerFormFields({ form }: { form: CustomerForm }) {
  const {
    register,
    control,
    watch,
    formState: { errors },
  } = form;
  const consentStatus = watch("consent.status");

  return (
    <div className="space-y-5">
      <FormSection title="Basics">
        <TextField label="Full name" autoComplete="off" error={errors.fullName?.message} {...register("fullName")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="01XXXXXXXXX"
            error={errors.phone?.message}
            {...register("phone")}
          />
          <TextField
            label="WhatsApp number (optional)"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            error={errors.whatsappNumber?.message}
            {...register("whatsappNumber")}
          />
        </div>
      </FormSection>

      <FormSection title="Contact">
        <TextField
          label="Email (optional)"
          type="email"
          inputMode="email"
          autoComplete="off"
          error={errors.email?.message}
          {...register("email")}
        />
        <TextAreaField label="Address (optional)" rows={2} error={errors.address?.message} {...register("address")} />
      </FormSection>

      <FormSection title="Classification">
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            control={control}
            name="segment"
            render={({ field }) => (
              <SelectField
                label="Segment"
                value={field.value}
                onValueChange={field.onChange}
                options={SEGMENT_OPTIONS}
                error={errors.segment?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="customerType"
            render={({ field }) => (
              <SelectField
                label="Customer type"
                value={field.value}
                onValueChange={field.onChange}
                options={TYPE_OPTIONS}
                error={errors.customerType?.message}
              />
            )}
          />
        </div>
        <TextField
          label="Lead source (optional)"
          placeholder="Facebook, referral, walk-in"
          autoComplete="off"
          error={errors.leadSource?.message}
          {...register("leadSource")}
        />
        <Controller
          control={control}
          name="tags"
          render={({ field }) => (
            <TagInput value={field.value ?? []} onChange={field.onChange} error={tagsErrorMessage(errors.tags)} />
          )}
        />
      </FormSection>

      <FormSection title="Preferences">
        <Controller
          control={control}
          name="preferences.language"
          render={({ field }) => (
            <SelectField
              label="Preferred language"
              value={field.value ?? LANGUAGE_NOT_SET}
              onValueChange={(v) => field.onChange(v === LANGUAGE_NOT_SET ? undefined : v)}
              options={LANGUAGE_OPTIONS}
              error={errors.preferences?.language?.message}
            />
          )}
        />
        <TextAreaField
          label="Notes (optional)"
          rows={3}
          error={errors.preferences?.notes?.message}
          {...register("preferences.notes")}
        />
      </FormSection>

      <FormSection title="Consent">
        <Controller
          control={control}
          name="consent.status"
          render={({ field }) => (
            <div className="space-y-2">
              <Label id="consent-status-label">Messaging consent</Label>
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                className="grid gap-2 sm:grid-cols-3"
                aria-labelledby="consent-status-label"
                aria-describedby={errors.consent?.status?.message ? "consent-status-error" : undefined}
              >
                {CONSENT_STATUSES.map((status) => (
                  <Label key={status} htmlFor={`consent-${status}`} className="gap-2 font-normal">
                    <RadioGroupItem id={`consent-${status}`} value={status} />
                    {CONSENT_LABELS[status]}
                  </Label>
                ))}
              </RadioGroup>
              <FieldError id="consent-status-error" message={errors.consent?.status?.message} />
            </div>
          )}
        />
        {consentStatus === "granted" ? (
          <TextField
            label="How was consent obtained?"
            placeholder="In store, WhatsApp opt-in, signup form"
            autoComplete="off"
            error={errors.consent?.source?.message}
            {...register("consent.source")}
          />
        ) : null}
      </FormSection>
    </div>
  );
}
