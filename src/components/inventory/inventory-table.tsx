import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";

import { StockBadge } from "@/components/inventory/stock-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { InventoryListItem } from "@/schemas/inventory";

interface InventoryTableProps {
  items: readonly InventoryListItem[];
  canWrite: boolean;
  onAdjust: (item: InventoryListItem) => void;
  /** Accessible table title, e.g. "Inventory, 25 stock items shown". */
  caption: string;
}

const productHref = (i: InventoryListItem) => `/products/${encodeURIComponent(i.productId)}`;
const describe = (i: InventoryListItem) => `${i.productName}, ${i.variantLabel}`;

function ProductLink({ item }: { item: InventoryListItem }) {
  return (
    <Link href={productHref(item)} className="font-medium text-foreground underline-offset-4 hover:underline">
      {item.productName}
    </Link>
  );
}

function AdjustButton({ item, onAdjust }: { item: InventoryListItem; onAdjust: (item: InventoryListItem) => void }) {
  return (
    <Button variant="outline" size="sm" onClick={() => onAdjust(item)} aria-label={`Adjust stock for ${describe(item)}`}>
      <SlidersHorizontal aria-hidden="true" />
      Adjust stock
    </Button>
  );
}

/** Desktop table (md and up). Mobile uses `InventoryCardList`. */
export function InventoryTable({ items, canWrite, onAdjust, caption }: InventoryTableProps) {
  return (
    <Card className="hidden gap-0 py-0 md:block">
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Product</TableHead>
            <TableHead scope="col">Variant</TableHead>
            <TableHead scope="col">SKU</TableHead>
            <TableHead scope="col" className="text-right">
              On hand
            </TableHead>
            <TableHead scope="col" className="text-right">
              Reserved
            </TableHead>
            <TableHead scope="col" className="text-right">
              Available
            </TableHead>
            <TableHead scope="col">
              <span className="sr-only">Stock status</span>
            </TableHead>
            {canWrite ? (
              <TableHead scope="col" className="w-px">
                <span className="sr-only">Actions</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="max-w-64 truncate">
                <ProductLink item={i} />
              </TableCell>
              <TableCell>{i.variantLabel}</TableCell>
              <TableCell className="font-mono text-xs">{i.sku ?? "-"}</TableCell>
              <TableCell className="text-right tabular-nums">{i.onHand}</TableCell>
              <TableCell className="text-right tabular-nums">{i.reserved}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{i.available}</TableCell>
              <TableCell>
                <StockBadge available={i.available} />
              </TableCell>
              {canWrite ? (
                <TableCell>
                  <AdjustButton item={i} onAdjust={onAdjust} />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/** Mobile card list (below md). */
export function InventoryCardList({ items, canWrite, onAdjust, caption }: InventoryTableProps) {
  return (
    <ul className="space-y-3 md:hidden" aria-label={caption}>
      {items.map((i) => (
        <li key={i.id}>
          <Card size="sm" className="gap-3">
            <div className="space-y-3 px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <div className="truncate">
                    <ProductLink item={i} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {i.variantLabel}
                    {i.sku ? <span className="font-mono text-xs"> ({i.sku})</span> : null}
                  </p>
                </div>
                <StockBadge available={i.available} />
              </div>
              <dl className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">On hand</dt>
                  <dd className="tabular-nums">{i.onHand}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Reserved</dt>
                  <dd className="tabular-nums">{i.reserved}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Available</dt>
                  <dd className="font-medium tabular-nums">{i.available}</dd>
                </div>
              </dl>
              {canWrite ? <AdjustButton item={i} onAdjust={onAdjust} /> : null}
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
