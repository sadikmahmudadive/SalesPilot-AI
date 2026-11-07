import Link from "next/link";
import { Eye, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Customer } from "@/schemas/customer";

interface CustomerRowActionsProps {
  customer: Customer;
  canWrite: boolean;
  onEdit: (customer: Customer) => void;
  onDelete: (customer: Customer) => void;
}

/** View / Edit / Delete icon buttons. Edit and Delete are not rendered at all without write access. */
export function CustomerRowActions({
  customer,
  canWrite,
  onEdit,
  onDelete,
}: CustomerRowActionsProps) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="icon-sm" asChild>
        <Link
          href={`/customers/${encodeURIComponent(customer.id)}`}
          aria-label={`View ${customer.fullName}`}
        >
          <Eye aria-hidden="true" />
        </Link>
      </Button>
      {canWrite ? (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${customer.fullName}`}
            onClick={() => onEdit(customer)}
          >
            <Pencil aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-destructive hover:text-destructive"
            aria-label={`Delete ${customer.fullName}`}
            onClick={() => onDelete(customer)}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </>
      ) : null}
    </div>
  );
}
