"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { FormAlert } from "@/components/auth/form-alert";
import { TextField } from "@/components/auth/text-field";
import {
  mapOrderSettingsApiError,
  settingsToForm,
  validateOrderSettingsForm,
  type OrderSettingsFieldName,
  type OrderSettingsFormValues,
} from "@/components/settings/order-settings-model";
import { QueryErrorState } from "@/components/shared/query-error-state";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrderSettings, useUpdateOrderSettings } from "@/hooks/use-orders";
import { asApiError } from "@/lib/api/map-error";
import type { OrderSettings } from "@/schemas/order";

type Errors = Partial<Record<OrderSettingsFieldName, string>>;
type Banner = { message: string; requestId?: string };

const READ_ONLY_NOTE = "Only an owner or admin can change these settings.";

interface FormProps {
  settings: OrderSettings;
  canManage: boolean;
}

/** Remounted (via `key`) when the saved settings change, so the typed text always starts from them. */
function SettingsForm({ settings, canManage }: FormProps) {
  const update = useUpdateOrderSettings();
  const [values, setValues] = useState<OrderSettingsFormValues>(() => settingsToForm(settings));
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<Banner | null>(null);

  const set = (name: OrderSettingsFieldName) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [name]: event.target.value }));
    setErrors((e) => ({ ...e, [name]: undefined }));
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage || update.isPending) return;
    setBanner(null);
    const checked = validateOrderSettingsForm(values);
    if (!checked.ok) {
      setErrors(checked.errors);
      setBanner({ message: "Some fields need attention. Check the highlighted fields below." });
      return;
    }
    setErrors({});
    try {
      await update.mutateAsync(checked.settings);
      toast.success("Order settings saved");
    } catch (error) {
      const mapped = mapOrderSettingsApiError(asApiError(error));
      const next: Errors = {};
      for (const f of mapped.fields) next[f.name] = f.message;
      setErrors(next);
      setBanner(
        mapped.formError
          ? { message: mapped.formError, requestId: mapped.requestId }
          : { message: "Some fields need attention. Check the highlighted fields below." },
      );
    }
  }

  const readOnly = !canManage;
  return (
    <form onSubmit={submit} noValidate aria-label="Order settings">
      <FormAlert message={banner?.message}>
        {banner?.requestId ? <p className="text-xs">Reference: {banner.requestId}</p> : null}
      </FormAlert>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label="Delivery charge inside Dhaka (taka)"
          inputMode="decimal"
          autoComplete="off"
          value={values.deliveryChargeInsideDhaka}
          onChange={set("deliveryChargeInsideDhaka")}
          error={errors.deliveryChargeInsideDhaka}
          disabled={readOnly}
        />
        <TextField
          label="Delivery charge outside Dhaka (taka)"
          inputMode="decimal"
          autoComplete="off"
          value={values.deliveryChargeOutsideDhaka}
          onChange={set("deliveryChargeOutsideDhaka")}
          error={errors.deliveryChargeOutsideDhaka}
          disabled={readOnly}
        />
        <TextField
          label="Draft hold (minutes)"
          inputMode="numeric"
          autoComplete="off"
          value={values.draftHoldMinutes}
          onChange={set("draftHoldMinutes")}
          error={errors.draftHoldMinutes}
          disabled={readOnly}
        />
        <TextField
          label="Online payment hold (hours)"
          inputMode="numeric"
          autoComplete="off"
          value={values.paymentHoldHours}
          onChange={set("paymentHoldHours")}
          error={errors.paymentHoldHours}
          disabled={readOnly}
        />
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        A draft keeps its stock for the draft hold; an order waiting for online payment keeps it for
        the payment hold. Changes apply to new orders and edits.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={readOnly || update.isPending}>
          {update.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Save settings
        </Button>
        {readOnly ? <p className="text-sm text-muted-foreground">{READ_ONLY_NOTE}</p> : null}
      </div>
    </form>
  );
}

/** The Orders tab of Settings: delivery charges and hold times. Read-only unless `canManage`. */
export function OrderSettingsForm({ canManage }: { canManage: boolean }) {
  const query = useOrderSettings();

  return (
    <SectionCard
      title="Orders"
      description="Delivery charges and how long stock is held for unconfirmed and unpaid orders."
    >
      {query.isPending ? (
        <div
          className="grid gap-5 sm:grid-cols-2"
          role="status"
          aria-label="Loading order settings"
        >
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <QueryErrorState
          title="Couldn't load order settings"
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : (
        <SettingsForm
          key={JSON.stringify(query.data)}
          settings={query.data}
          canManage={canManage}
        />
      )}
    </SectionCard>
  );
}
