"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { FormAlert } from "@/components/auth/form-alert";
import { TextField } from "@/components/auth/text-field";
import {
  parseQuantity,
  previewAdjustment,
  toDelta,
  type AdjustMode,
} from "@/components/inventory/stock-model";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { isUnconfirmedError, useAdjustStock } from "@/hooks/use-inventory";
import { ApiError } from "@/lib/api/client";
import { MAX_REASON_LENGTH } from "@/config/inventory";
import { reasonSchema, type InventoryListItem } from "@/schemas/inventory";

const UNCONFIRMED_MESSAGE = "We couldn't confirm the change. Check the current stock before trying again.";

interface AdjustFormProps {
  item: InventoryListItem;
  onClose: () => void;
}

function AdjustForm({ item, onClose }: AdjustFormProps) {
  const adjust = useAdjustStock();
  const lock = useRef(false);
  const [mode, setMode] = useState<AdjustMode>("add");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ quantity?: string; reason?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [pending, setPending] = useState(false);

  const parsed = quantity.trim() ? parseQuantity(quantity) : null;
  const preview = parsed?.ok ? previewAdjustment(item, toDelta(parsed.value, mode)) : null;
  const blocked = preview !== null && !preview.ok;
  const problem = blocked || (parsed !== null && !parsed.ok);
  const previewText = !parsed
    ? "Enter a quantity to preview the result."
    : !parsed.ok
      ? parsed.message
      : preview?.ok
        ? preview.summary
        : preview?.message;

  async function submit() {
    // NOT idempotent: a second request would apply the change twice, so lock synchronously first.
    if (lock.current || unconfirmed) return;
    const nextErrors: typeof errors = {};
    const qty = parseQuantity(quantity);
    if (!qty.ok) nextErrors.quantity = qty.message;
    const why = reasonSchema.safeParse(reason);
    if (!why.success) nextErrors.reason = why.error.issues[0]?.message ?? "Enter a reason";
    const delta = qty.ok ? toDelta(qty.value, mode) : 0;
    const check = qty.ok ? previewAdjustment(item, delta) : null;
    if (check && !check.ok) nextErrors.quantity = check.message;
    setErrors(nextErrors);
    if (nextErrors.quantity || nextErrors.reason || !why.success) return;

    lock.current = true;
    setPending(true);
    setFormError(null);
    try {
      await adjust.mutateAsync({ productId: item.productId, variantId: item.variantId, delta, reason: why.data });
      toast.success(`Stock updated for ${item.productName}`);
      onClose();
    } catch (error) {
      if (isUnconfirmedError(error)) {
        // The change may or may not have been applied. No retry button: look at the refreshed stock first.
        setUnconfirmed(true);
        setQuantity("");
        setFormError(UNCONFIRMED_MESSAGE);
      } else if (error instanceof ApiError && error.details.length > 0) {
        const byPath = (p: string) => error.details.find((d) => d.path === p)?.message;
        setErrors({ quantity: byPath("delta"), reason: byPath("reason") });
        setFormError(error.details.some((d) => d.path !== "delta" && d.path !== "reason") ? error.message : null);
      } else {
        // e.g. 409 "Inventory is busy, please try again": safe to retry by hand, nothing was applied.
        setFormError(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
      }
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="space-y-4"
    >
      <FormAlert message={formError}>
        {unconfirmed ? (
          <p className="text-xs">
            Current stock: on hand {item.onHand}, reserved {item.reserved}, available {item.available}.
          </p>
        ) : null}
      </FormAlert>

      <dl className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-3 text-center text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">On hand</dt>
          <dd className="font-medium tabular-nums">{item.onHand}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Reserved</dt>
          <dd className="font-medium tabular-nums">{item.reserved}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Available</dt>
          <dd className="font-medium tabular-nums">{item.available}</dd>
        </div>
      </dl>

      <fieldset disabled={unconfirmed || pending} className="m-0 min-w-0 space-y-4 border-0 p-0">
        <div className="space-y-2">
          <Label id="adjust-mode-label">Change</Label>
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as AdjustMode)}
            className="grid grid-cols-2 gap-2"
            aria-labelledby="adjust-mode-label"
          >
            <Label htmlFor="adjust-add" className="gap-2 font-normal">
              <RadioGroupItem id="adjust-add" value="add" />
              Add stock
            </Label>
            <Label htmlFor="adjust-remove" className="gap-2 font-normal">
              <RadioGroupItem id="adjust-remove" value="remove" />
              Remove stock
            </Label>
          </RadioGroup>
        </div>

        <TextField
          label="Quantity"
          inputMode="numeric"
          autoComplete="off"
          placeholder="e.g. 10"
          value={quantity}
          onChange={(e) => {
            setQuantity(e.target.value);
            setErrors((prev) => ({ ...prev, quantity: undefined }));
          }}
          error={errors.quantity}
        />
        <p aria-live="polite" className={`min-h-5 text-sm ${problem ? "text-destructive" : "text-muted-foreground"}`}>
          {previewText}
        </p>

        <TextField
          label="Reason"
          autoComplete="off"
          placeholder="e.g. New delivery from supplier"
          maxLength={MAX_REASON_LENGTH}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setErrors((prev) => ({ ...prev, reason: undefined }));
          }}
          error={errors.reason}
        />
      </fieldset>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          {unconfirmed ? "Close" : "Cancel"}
        </Button>
        {unconfirmed ? null : (
          <Button type="submit" disabled={pending || blocked} aria-busy={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Update stock
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}

interface AdjustDialogProps {
  /** The stock item to adjust (kept fresh by the list); `null` keeps the dialog closed. */
  item: InventoryListItem | null;
  onOpenChange: (open: boolean) => void;
}

/** Dialog to add or remove stock for one product variant, with a live preview of the result. */
export function AdjustDialog({ item, onOpenChange }: AdjustDialogProps) {
  // Keep the last item so the title does not change while the dialog animates closed.
  const [last, setLast] = useState(item);
  if (item && item.id !== last?.id) setLast(item);
  const shown = item ?? last;

  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
          <DialogDescription>
            {shown ? `${shown.productName} (${shown.variantLabel}${shown.sku ? `, ${shown.sku}` : ""})` : ""}
          </DialogDescription>
        </DialogHeader>
        {item ? <AdjustForm key={item.id} item={item} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
