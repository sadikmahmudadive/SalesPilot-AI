"use client";

import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useDeleteCustomer } from "@/hooks/use-customers";

interface DeleteCustomerDialogProps {
  /** The customer to delete; `null` keeps the dialog closed. */
  customer: { id: string; fullName: string } | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: (id: string) => void;
}

export function DeleteCustomerDialog({
  customer,
  onOpenChange,
  onDeleted,
}: DeleteCustomerDialogProps) {
  const remove = useDeleteCustomer();
  // Keep the last customer so the title does not change while the dialog animates closed.
  const [lastCustomer, setLastCustomer] = useState(customer);
  if (customer && customer !== lastCustomer) setLastCustomer(customer);
  const shown = customer ?? lastCustomer;

  return (
    <ConfirmDialog
      open={customer !== null}
      onOpenChange={onOpenChange}
      title={`Delete ${shown?.fullName ?? "customer"}?`}
      description="This permanently removes the customer record. It cannot be undone."
      confirmLabel="Delete customer"
      errorFallback="Could not delete the customer. Please try again."
      onConfirm={async () => {
        if (!customer) return;
        await remove.mutateAsync(customer.id);
        toast.success(`${customer.fullName} was deleted`);
        onDeleted?.(customer.id);
      }}
    />
  );
}
