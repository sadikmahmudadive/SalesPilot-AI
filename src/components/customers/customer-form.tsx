"use client";

import { useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { FormAlert } from "@/components/auth/form-alert";
import { CustomerFormFields } from "@/components/customers/customer-form-fields";
import {
  buildPatch,
  customerToFormValues,
  EMPTY_FORM_VALUES,
  mapApiError,
  prepareCustomerBody,
  type CustomerFormValues,
} from "@/components/customers/customer-form-model";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateCustomer, useUpdateCustomer } from "@/hooks/use-customers";
import { ApiError } from "@/lib/api/client";
import { customerInputSchema, type Customer } from "@/schemas/customer";

type FormOutput = z.output<typeof customerInputSchema>;

// Validate what will actually be sent (trimmed, blanks dropped), so error paths match the API's.
const baseResolver = zodResolver(customerInputSchema);
const resolver: Resolver<CustomerFormValues, unknown, FormOutput> = (values, context, options) =>
  baseResolver(prepareCustomerBody(values), context, options);

interface CustomerFormProps {
  customer?: Customer;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  onSaved: () => void;
}

function CustomerForm({ customer, onDirtyChange, onCancel, onSaved }: CustomerFormProps) {
  const create = useCreateCustomer();
  const update = useUpdateCustomer();
  const submitLock = useRef(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<{ message: string; requestId?: string } | null>(null);

  // Frozen at mount: the edit diff must not move if the customer prop refreshes while the dialog is open.
  const [defaults] = useState(() => (customer ? customerToFormValues(customer) : EMPTY_FORM_VALUES));
  const form = useForm<CustomerFormValues, unknown, FormOutput>({
    resolver,
    defaultValues: defaults,
  });
  const { handleSubmit, setError, setFocus, getValues, formState } = form;

  const isEdit = customer !== undefined;
  const dirty = formState.isDirty;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  async function save() {
    if (submitLock.current) return; // synchronous guard: two quick submits cannot both pass
    submitLock.current = true;
    setPending(true);
    setFormError(null);
    try {
      const next = prepareCustomerBody(getValues());
      if (customer) {
        const patch = buildPatch(prepareCustomerBody(defaults), next);
        if (Object.keys(patch).length === 0) {
          toast.info("No changes to save");
          onSaved();
          return;
        }
        await update.mutateAsync({ id: customer.id, body: patch });
      } else {
        await create.mutateAsync(next);
      }
      toast.success(isEdit ? "Customer updated" : "Customer added");
      onSaved();
    } catch (error) {
      const mapped = mapApiError(
        error instanceof ApiError
          ? error
          : new ApiError({
              status: 0,
              code: "UNKNOWN",
              message: "Something went wrong. Please try again.",
            }),
      );
      for (const field of mapped.fields) setError(field.name, { type: "server", message: field.message });
      const first = mapped.fields[0];
      if (first) setFocus(first.name);
      setFormError(mapped.formError ? { message: mapped.formError, requestId: mapped.requestId } : null);
    } finally {
      submitLock.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(save)(event)} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        <FormAlert message={formError?.message}>
          {formError?.requestId ? <p className="text-xs">Reference: {formError.requestId}</p> : null}
        </FormAlert>
        <CustomerFormFields form={form} />
      </div>
      <DialogFooter className="pt-6">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {isEdit ? "Save changes" : "Add customer"}
        </Button>
      </DialogFooter>
    </form>
  );
}

interface CustomerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing. */
  customer?: Customer;
}

/** Create / edit dialog. Closing with unsaved edits asks for confirmation first. */
export function CustomerFormDialog({ open, onOpenChange, customer }: CustomerFormDialogProps) {
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  function requestClose(next: boolean) {
    if (next) return onOpenChange(true);
    if (dirty) setConfirmDiscard(true);
    else onOpenChange(false);
  }

  function close() {
    setDirty(false);
    setConfirmDiscard(false);
    onOpenChange(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={requestClose}>
        <DialogContent
          className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-xl"
          aria-describedby="customer-form-description"
        >
          <DialogHeader>
            <DialogTitle>{customer ? "Edit customer" : "Add customer"}</DialogTitle>
            <DialogDescription id="customer-form-description">
              {customer ? "Update this customer's details." : "Save a new customer to your CRM."}
            </DialogDescription>
          </DialogHeader>
          <CustomerForm
            customer={customer}
            onDirtyChange={setDirty}
            onCancel={() => requestClose(false)}
            onSaved={close}
          />
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              The details you entered have not been saved and will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={close}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
