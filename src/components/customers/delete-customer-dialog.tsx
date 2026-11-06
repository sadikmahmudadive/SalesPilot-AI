"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDeleteCustomer } from "@/hooks/use-customers";
import { ApiError } from "@/lib/api/client";

interface DeleteCustomerDialogProps {
  /** The customer to delete; `null` keeps the dialog closed. */
  customer: { id: string; fullName: string } | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: (id: string) => void;
}

export function DeleteCustomerDialog({ customer, onOpenChange, onDeleted }: DeleteCustomerDialogProps) {
  const remove = useDeleteCustomer();
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const pending = remove.isPending;

  async function confirm() {
    if (!customer || lock.current) return;
    lock.current = true;
    setError(null);
    try {
      await remove.mutateAsync(customer.id);
      toast.success(`${customer.fullName} was deleted`);
      onOpenChange(false);
      onDeleted?.(customer.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete the customer. Please try again.");
    } finally {
      lock.current = false;
    }
  }

  return (
    <AlertDialog
      open={customer !== null}
      onOpenChange={(open) => {
        if (pending) return; // do not close mid-request
        if (!open) setError(null);
        onOpenChange(open);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {customer?.fullName ?? "customer"}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the customer record. It cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div role="alert">{error ? <p className="text-sm text-destructive">{error}</p> : null}</div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            aria-busy={pending}
            onClick={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Delete customer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
