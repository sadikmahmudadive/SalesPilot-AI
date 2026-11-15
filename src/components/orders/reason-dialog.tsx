"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { FormAlert } from "@/components/auth/form-alert";
import { TextField } from "@/components/auth/text-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError } from "@/lib/api/client";
import { guardOpenChange, pendingDismissProps } from "@/lib/dialog-guard";
import { reasonSchema } from "@/schemas/order";

const MAX_REASON = 300;

interface ReasonFormProps {
  label: string;
  placeholder?: string;
  confirmLabel: string;
  destructive: boolean;
  /** Runs the action with the trimmed reason. Reject to keep the dialog open and show the error. */
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
}

function ReasonForm({
  label,
  placeholder,
  confirmLabel,
  destructive,
  onSubmit,
  onClose,
  onPendingChange,
}: ReasonFormProps) {
  const lock = useRef(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    // Not safe to run twice (a second refund or cancel would fail or double-record): lock first.
    if (lock.current) return;
    const parsed = reasonSchema.shape.reason.safeParse(reason);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a reason");
      return;
    }
    lock.current = true;
    setPending(true);
    onPendingChange(true);
    setFormError(null);
    try {
      await onSubmit(parsed.data);
      onClose();
    } catch (e) {
      // Conflicts ("The order hold has expired", "Another change ...") are shown as the server words them.
      setFormError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      lock.current = false;
      setPending(false);
      onPendingChange(false);
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
      <FormAlert message={formError} />
      <TextField
        label={label}
        autoComplete="off"
        placeholder={placeholder}
        maxLength={MAX_REASON}
        value={reason}
        disabled={pending}
        onChange={(e) => {
          setReason(e.target.value);
          setError(undefined);
        }}
        error={error}
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Keep order as is
        </Button>
        <Button
          type="submit"
          variant={destructive ? "destructive" : "default"}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  /** Label of the text field, e.g. "Reason for cancelling". */
  label: string;
  placeholder?: string;
  confirmLabel: string;
  destructive?: boolean;
  onSubmit: (reason: string) => Promise<void>;
}

/** Dialog that asks for a short reason (1 to 300 characters) before an order action runs. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  confirmLabel,
  destructive = false,
  onSubmit,
}: ReasonDialogProps) {
  // While a request runs, no way of closing the dialog may discard its outcome.
  const [pending, setPending] = useState(false);

  return (
    <Dialog open={open} onOpenChange={guardOpenChange(pending, onOpenChange)}>
      <DialogContent className="sm:max-w-md" {...pendingDismissProps(pending)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {open ? (
          <ReasonForm
            label={label}
            placeholder={placeholder}
            confirmLabel={confirmLabel}
            destructive={destructive}
            onSubmit={onSubmit}
            onClose={() => onOpenChange(false)}
            onPendingChange={setPending}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
