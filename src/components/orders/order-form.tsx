"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Controller, useForm, useWatch, type FieldPath, type UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import { FormAlert } from "@/components/auth/form-alert";
import { TextField } from "@/components/auth/text-field";
import { PageHeader } from "@/components/dashboard/page-header";
import { CustomerPicker } from "@/components/orders/customer-picker";
import { LineEditor } from "@/components/orders/line-editor";
import {
  buildDraftPatch,
  EMPTY_ORDER_VALUES,
  errorMessageAt,
  mapOrderApiError,
  newIdempotencyKey,
  orderToFormValues,
  previewTotals,
  retailPriceMinor,
  toCreateBody,
  validateOrderForm,
  type OrderFieldName,
  type OrderFormValues,
} from "@/components/orders/order-form-model";
import { DiscardChangesDialog } from "@/components/shared/discard-changes-dialog";
import { FieldError, TextAreaField } from "@/components/shared/form-controls";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  useCreateOrder,
  useOrderSettings,
  useUpdateDraft,
  type OrderDetail,
} from "@/hooks/use-orders";
import { useProductsByIds } from "@/hooks/use-products";
import { useRevealAlert } from "@/hooks/use-reveal-alert";
import { useBeforeUnloadGuard } from "@/hooks/use-unsaved-changes";
import { asApiError } from "@/lib/api/map-error";
import { formatMoneyMinor } from "@/lib/format";
import type { Customer } from "@/schemas/customer";

const LIST_PATH = "/orders";
const INVALID_MESSAGE = "Some fields need attention. Check the highlighted fields below.";

type Form = UseFormReturn<OrderFormValues>;
type Banner = { message: string; requestId?: string; reveal: boolean };

function Summary({ form }: { form: Form }) {
  const values = useWatch({ control: form.control }) as OrderFormValues;
  const settings = useOrderSettings();
  const { products } = useProductsByIds(values.lines.map((l) => l.productId));
  const totals = useMemo(() => {
    if (!settings.data) return null;
    const prices = new Map([...products].map(([id, p]) => [id, retailPriceMinor(p)]));
    return previewTotals(values, prices, settings.data);
  }, [values, products, settings.data]);

  const rows: Array<[string, string]> = totals
    ? [
        ["Subtotal", formatMoneyMinor(totals.subtotalMinor)],
        ["Discount", `-${formatMoneyMinor(totals.discountMinor)}`],
        ["Delivery", formatMoneyMinor(totals.deliveryChargeMinor)],
      ]
    : [];

  return (
    <SectionCard
      title="Summary"
      description="Prices are today's retail prices. They are checked again when you save."
    >
      <div aria-live="polite">
        {totals ? (
          <dl className="space-y-1.5 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t pt-2 text-base font-medium">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatMoneyMinor(totals.totalMinor)}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            {settings.isError
              ? "Totals are unavailable right now."
              : "Totals appear once every item has a product and quantity, and a delivery zone is chosen."}
          </p>
        )}
      </div>
    </SectionCard>
  );
}

interface OrderFormProps {
  /** Present when editing a draft; the form then sends only what changed. */
  order?: OrderDetail;
  /** Edit mode: leave without saving. */
  onCancel?: () => void;
  /** Edit mode: saved (or nothing to save). */
  onSaved?: () => void;
}

/**
 * Create / edit form for an order. New orders are created as a draft ("Save draft") or created and
 * confirmed in one step; editing sends a minimal PATCH. The idempotency key is made once per mount,
 * so a double click or a retry after a half-finished save (draft created, confirm refused) lands on
 * the same order instead of making a second one.
 */
export function OrderForm({ order, onCancel, onSaved }: OrderFormProps) {
  const router = useRouter();
  const create = useCreateOrder();
  const update = useUpdateDraft(order?.id ?? "");
  const settings = useOrderSettings();
  const lock = useRef(false);
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const alertRef = useRevealAlert(banner?.reveal ? banner : null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const isEdit = order !== undefined;

  // Frozen at mount: the edit diff must not move if the order refreshes while the form is open.
  const [baseline] = useState<OrderFormValues>(() =>
    order ? orderToFormValues(order) : EMPTY_ORDER_VALUES,
  );
  const form = useForm<OrderFormValues>({ defaultValues: baseline });
  const {
    register,
    control,
    setValue,
    getValues,
    setError,
    clearErrors,
    setFocus,
    reset,
    formState,
  } = form;
  const [customer, setCustomer] = useState<Pick<Customer, "id" | "fullName" | "phone"> | null>(
    order
      ? {
          id: order.customerId,
          fullName: order.customerSnapshot.name,
          phone: order.customerSnapshot.phoneE164,
        }
      : null,
  );

  const lineProductIds = (useWatch({ control, name: "lines" }) ?? []).map((l) => l.productId);
  const { products, loading: productsLoading } = useProductsByIds(lineProductIds);

  const dirty = formState.isDirty;
  useBeforeUnloadGuard(dirty && !pending);

  const err = (name: OrderFieldName): string | undefined => errorMessageAt(formState.errors, name);
  const field = (name: Exclude<OrderFieldName, `lines.${string}`>) =>
    register(name as FieldPath<OrderFormValues>, { onChange: () => clearErrors(name) });

  function pickCustomer(c: Customer | null) {
    setCustomer(c);
    setValue("customerId", c?.id ?? "", { shouldDirty: true });
    clearErrors("customerId");
    if (!c) return;
    // Prefill the delivery details from the CRM; everything stays editable.
    const opts = { shouldDirty: true } as const;
    setValue("address.recipientName", c.fullName, opts);
    setValue("address.phone", c.phone, opts);
    setValue("address.line1", c.address ?? "", opts);
    clearErrors(["address.recipientName", "address.phone", "address.line1"]);
  }

  function showErrors(fields: Array<{ name: OrderFieldName; message: string }>) {
    for (const f of fields)
      setError(f.name as FieldPath<OrderFormValues>, { type: "server", message: f.message });
    const focusable = fields.find(
      (f) => !f.name.endsWith("root") && !f.name.startsWith("lines.") && f.name !== "customerId",
    );
    // Deferred: after a failed request the fieldset is still disabled until the next render.
    if (focusable) setTimeout(() => setFocus(focusable.name as FieldPath<OrderFormValues>), 0);
    return focusable !== undefined;
  }

  async function submit(confirm: boolean) {
    if (lock.current) return; // synchronous guard: two quick submits cannot both pass
    clearErrors();
    setBanner(null);
    const values = getValues();

    const problems = validateOrderForm(values);
    const fields = problems.ok ? [] : [...problems.fields];
    values.lines.forEach((line, i) => {
      const product = products.get(line.productId);
      if (product && product.variants.length > 0 && line.variantId === "") {
        fields.push({ name: `lines.${i}.variantId`, message: "Choose a variant" });
      }
    });
    if (fields.length > 0) {
      const focused = showErrors(fields);
      setBanner({ message: INVALID_MESSAGE, reveal: !focused });
      return;
    }

    lock.current = true;
    setPending(true);
    let finished = false;
    try {
      if (order) {
        const patch = buildDraftPatch(baseline, values);
        if (Object.keys(patch).length === 0) {
          toast.info("No changes to save");
        } else {
          await update.mutateAsync(patch);
          toast.success("Draft updated");
        }
        reset(values); // not dirty any more: leaving is not a "discard"
        finished = true;
        onSaved?.();
      } else {
        const created = await create.mutateAsync(toCreateBody(values, idempotencyKey, confirm));
        reset(values);
        finished = true;
        toast.success(confirm ? "Order created and confirmed" : "Draft saved");
        router.push(`${LIST_PATH}/${encodeURIComponent(created.id)}`);
      }
    } catch (error) {
      const mapped = mapOrderApiError(asApiError(error));
      const focused = showErrors(mapped.fields);
      setBanner(
        mapped.formError
          ? { message: mapped.formError, requestId: mapped.requestId, reveal: !focused }
          : mapped.fields.length > 0
            ? { message: INVALID_MESSAGE, reveal: !focused }
            : null,
      );
    } finally {
      lock.current = false;
      // After a create the page navigates away: keep the buttons off until it does.
      if (!(finished && !isEdit)) setPending(false);
    }
  }

  function requestLeave() {
    if (dirty) setConfirmDiscard(true);
    else if (onCancel) onCancel();
    else router.push(LIST_PATH);
  }

  const zoneOptions = [
    {
      value: "inside_dhaka",
      label: "Inside Dhaka",
      charge: settings.data?.deliveryChargeInsideDhakaMinor,
    },
    {
      value: "outside_dhaka",
      label: "Outside Dhaka",
      charge: settings.data?.deliveryChargeOutsideDhakaMinor,
    },
  ] as const;

  return (
    <div>
      {!isEdit ? (
        <>
          <Button variant="ghost" size="sm" className="-ml-2.5 mb-3" onClick={requestLeave}>
            <ArrowLeft aria-hidden="true" />
            All orders
          </Button>
          <PageHeader
            title="New order"
            description="Pick a customer, add items and choose how it is delivered and paid."
          />
        </>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground">
          Edit this draft. The new quantities must be in stock while the old ones are still held, so
          a large increase can be refused.
        </p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(false);
        }}
        noValidate
        aria-label={isEdit ? "Edit draft order" : "New order"}
      >
        <FormAlert ref={alertRef} message={banner?.message}>
          {banner?.requestId ? <p className="text-xs">Reference: {banner.requestId}</p> : null}
        </FormAlert>

        <fieldset disabled={pending} className="m-0 min-w-0 space-y-4 border-0 p-0">
          <SectionCard title="Customer">
            {isEdit ? (
              <div className="text-sm">
                <p className="font-medium">{customer?.fullName}</p>
                <p className="text-xs text-muted-foreground tabular-nums">{customer?.phone}</p>
              </div>
            ) : (
              <CustomerPicker
                value={customer}
                onChange={pickCustomer}
                error={err("customerId")}
                disabled={pending}
              />
            )}
          </SectionCard>

          <SectionCard
            title="Items"
            description="Search the catalogue. Stock shown is what is free to sell now."
          >
            <LineEditor
              form={form}
              products={products}
              productsLoading={productsLoading}
              disabled={pending}
            />
          </SectionCard>

          <SectionCard title="Delivery">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Recipient name"
                autoComplete="off"
                error={err("address.recipientName")}
                {...field("address.recipientName")}
              />
              <TextField
                label="Phone"
                type="tel"
                autoComplete="off"
                error={err("address.phone")}
                {...field("address.phone")}
              />
            </div>
            <TextField
              label="Address"
              autoComplete="off"
              error={err("address.line1")}
              {...field("address.line1")}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Area"
                autoComplete="off"
                error={err("address.area")}
                {...field("address.area")}
              />
              <TextField
                label="District"
                autoComplete="off"
                error={err("address.district")}
                {...field("address.district")}
              />
            </div>
            <div className="space-y-2">
              <Label id="order-zone-label">Delivery zone</Label>
              <Controller
                control={control}
                name="address.zone"
                render={({ field: zone }) => (
                  <RadioGroup
                    value={zone.value}
                    onValueChange={(v) => {
                      zone.onChange(v);
                      clearErrors("address.zone");
                    }}
                    aria-labelledby="order-zone-label"
                    aria-invalid={err("address.zone") ? true : undefined}
                    className="grid gap-2 sm:grid-cols-2"
                  >
                    {zoneOptions.map((o) => (
                      <Label
                        key={o.value}
                        htmlFor={`zone-${o.value}`}
                        className="gap-2 font-normal"
                      >
                        <RadioGroupItem id={`zone-${o.value}`} value={o.value} />
                        {o.label}
                        {o.charge !== undefined ? (
                          <span className="text-muted-foreground tabular-nums">
                            ({formatMoneyMinor(o.charge)})
                          </span>
                        ) : null}
                      </Label>
                    ))}
                  </RadioGroup>
                )}
              />
              <FieldError id="order-zone-error" message={err("address.zone")} />
            </div>
            <TextAreaField
              label="Delivery note"
              rows={2}
              error={err("address.note")}
              {...field("address.note")}
            />
          </SectionCard>

          <SectionCard title="Payment">
            <div className="space-y-2">
              <Label id="order-payment-label">Payment method</Label>
              <Controller
                control={control}
                name="paymentMethod"
                render={({ field: method }) => (
                  <RadioGroup
                    value={method.value}
                    onValueChange={(v) => {
                      method.onChange(v);
                      clearErrors("paymentMethod");
                    }}
                    aria-labelledby="order-payment-label"
                    className="grid gap-2 sm:grid-cols-2"
                  >
                    <Label htmlFor="payment-cod" className="gap-2 font-normal">
                      <RadioGroupItem id="payment-cod" value="cod" />
                      Cash on delivery
                    </Label>
                    <Label htmlFor="payment-online" className="gap-2 font-normal">
                      <RadioGroupItem id="payment-online" value="online" />
                      Online payment
                    </Label>
                  </RadioGroup>
                )}
              />
              <FieldError id="order-payment-error" message={err("paymentMethod")} />
            </div>
            <TextField
              label="Discount (taka)"
              inputMode="decimal"
              autoComplete="off"
              placeholder="e.g. 150.50"
              error={err("discount")}
              {...field("discount")}
            />
            <TextAreaField
              label="Internal notes"
              rows={3}
              error={err("notes")}
              {...field("notes")}
            />
          </SectionCard>

          <Summary form={form} />
        </fieldset>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          {isEdit ? (
            <Button type="button" variant="outline" onClick={requestLeave} disabled={pending}>
              Cancel
            </Button>
          ) : null}
          <Button
            type="submit"
            variant={isEdit ? "default" : "outline"}
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {isEdit ? "Save changes" : "Save draft"}
          </Button>
          {!isEdit ? (
            <Button
              type="button"
              disabled={pending}
              aria-busy={pending}
              onClick={() => void submit(true)}
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Create confirmed
            </Button>
          ) : null}
        </div>
      </form>

      <DiscardChangesDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        onDiscard={() => {
          setConfirmDiscard(false);
          reset(getValues()); // clear dirty so the leave is not blocked again
          if (onCancel) onCancel();
          else router.push(LIST_PATH);
        }}
      />
    </div>
  );
}
