"use client";

import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useArchiveProduct } from "@/hooks/use-products";

interface ArchiveProductDialogProps {
  /** The product to archive; `null` keeps the dialog closed. */
  product: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  onArchived: (id: string) => void;
}

/** Confirmation before archiving. Archiving is a soft delete: the product can be restored later. */
export function ArchiveProductDialog({ product, onOpenChange, onArchived }: ArchiveProductDialogProps) {
  const archive = useArchiveProduct();
  // Keep the last product so the title does not change while the dialog animates closed.
  const [last, setLast] = useState(product);
  if (product && product !== last) setLast(product);
  const shown = product ?? last;

  return (
    <ConfirmDialog
      open={product !== null}
      onOpenChange={onOpenChange}
      title={`Archive ${shown?.name ?? "product"}?`}
      description="Archived products are hidden from the catalogue and are not offered to customers. Stock and history are kept, and you can restore the product later by setting it to Active or Draft. Unsaved edits on this page are not saved."
      confirmLabel="Archive product"
      errorFallback="Could not archive the product. Please try again."
      destructive={false}
      onConfirm={async () => {
        if (!product) return;
        await archive.mutateAsync(product.id);
        toast.success(`${product.name} was archived`);
        onArchived(product.id);
      }}
    />
  );
}
