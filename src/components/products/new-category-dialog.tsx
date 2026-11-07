"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { TextField } from "@/components/auth/text-field";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateCategory } from "@/hooks/use-categories";
import { ApiError } from "@/lib/api/client";
import { categoryInputSchema, type Category } from "@/schemas/product";

interface NewCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the created category so the caller can select it. */
  onCreated: (category: Category) => void;
}

const DUPLICATE_MESSAGE = "A category with this name already exists";

/** Small dialog to add a category without leaving the product editor. */
export function NewCategoryDialog({ open, onOpenChange, onCreated }: NewCategoryDialogProps) {
  const create = useCreateCategory();
  const lock = useRef(false);
  const [name, setName] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setName("");
    setFieldError(undefined);
    setFormError(null);
  }

  async function submit() {
    if (lock.current) return; // synchronous guard against a double submit
    const parsed = categoryInputSchema.safeParse({ name });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Enter the category name");
      return;
    }
    lock.current = true;
    setPending(true);
    setFieldError(undefined);
    setFormError(null);
    try {
      const category = await create.mutateAsync(parsed.data);
      toast.success(`Category "${category.name}" added`);
      onCreated(category);
      reset();
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONFLICT") setFieldError(DUPLICATE_MESSAGE);
      else
        setFormError(
          error instanceof ApiError
            ? error.message
            : "Could not add the category. Please try again.",
        );
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New category</DialogTitle>
          <DialogDescription>Categories group products in your catalogue.</DialogDescription>
        </DialogHeader>
        {/* This dialog renders inside the product form in the React tree: stop its submit from reaching the product form. */}
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void submit();
          }}
          className="space-y-4"
        >
          <FormAlert message={formError} />
          <TextField
            label="Category name"
            autoComplete="off"
            autoFocus
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={fieldError}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Add category
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
