import Link from "next/link";

import { CustomerRowActions } from "@/components/customers/customer-row-actions";
import { CustomerTags } from "@/components/customers/customer-tags";
import { SegmentBadge } from "@/components/customers/segment-badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TYPE_LABELS } from "@/config/customer-labels";
import { formatDateOr, formatMoneyMinor } from "@/lib/format";
import type { Customer } from "@/schemas/customer";

interface CustomerTableProps {
  customers: readonly Customer[];
  canWrite: boolean;
  onEdit: (customer: Customer) => void;
  onDelete: (customer: Customer) => void;
  /** Accessible table title, e.g. "Customers, 25 shown". */
  caption: string;
}

const lastActivity = (c: Customer) => formatDateOr(c.lastInteractionAt, "No activity yet");

function NameLink({ customer }: { customer: Customer }) {
  return (
    <Link
      href={`/customers/${encodeURIComponent(customer.id)}`}
      className="font-medium text-foreground underline-offset-4 hover:underline"
    >
      {customer.fullName}
    </Link>
  );
}

/** Desktop table (md and up). Mobile uses `CustomerCardList`. */
export function CustomerTable({
  customers,
  canWrite,
  onEdit,
  onDelete,
  caption,
}: CustomerTableProps) {
  return (
    <Card className="hidden gap-0 py-0 md:block">
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Name</TableHead>
            <TableHead scope="col">Phone</TableHead>
            <TableHead scope="col">Segment</TableHead>
            <TableHead scope="col">Type</TableHead>
            <TableHead scope="col">Last activity</TableHead>
            <TableHead scope="col" className="text-right">
              Total spent
            </TableHead>
            <TableHead scope="col" className="w-px">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="max-w-64 space-y-1 whitespace-normal">
                <div className="truncate">
                  <NameLink customer={c} />
                </div>
                <CustomerTags tags={c.tags} />
              </TableCell>
              <TableCell className="tabular-nums">{c.phone}</TableCell>
              <TableCell>
                <SegmentBadge segment={c.segment} />
              </TableCell>
              <TableCell>{TYPE_LABELS[c.customerType]}</TableCell>
              <TableCell className="text-muted-foreground">{lastActivity(c)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoneyMinor(c.totalSpendMinor)}
              </TableCell>
              <TableCell>
                <CustomerRowActions
                  customer={c}
                  canWrite={canWrite}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/** Mobile card list (below md). */
export function CustomerCardList({
  customers,
  canWrite,
  onEdit,
  onDelete,
  caption,
}: CustomerTableProps) {
  return (
    <ul className="space-y-3 md:hidden" aria-label={caption}>
      {customers.map((c) => (
        <li key={c.id}>
          <Card size="sm" className="gap-3">
            <div className="space-y-3 px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <div className="truncate">
                    <NameLink customer={c} />
                  </div>
                  <p className="text-sm text-muted-foreground tabular-nums">{c.phone}</p>
                </div>
                <SegmentBadge segment={c.segment} />
              </div>
              <CustomerTags tags={c.tags} />
              <dl className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">Type</dt>
                  <dd>{TYPE_LABELS[c.customerType]}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Last activity</dt>
                  <dd>{lastActivity(c)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Total spent</dt>
                  <dd className="tabular-nums">{formatMoneyMinor(c.totalSpendMinor)}</dd>
                </div>
              </dl>
              <CustomerRowActions
                customer={c}
                canWrite={canWrite}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
