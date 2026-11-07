import Link from "next/link";
import { Eye, Pencil } from "lucide-react";

import { AvailabilityBadge } from "@/components/products/availability-badge";
import { PriceDisplay } from "@/components/products/price-display";
import { ProductThumb } from "@/components/products/product-thumb";
import { Button } from "@/components/ui/button";
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
import type { Product } from "@/schemas/product";

interface ProductTableProps {
  products: readonly Product[];
  /** Category id -> name. */
  categoryNames: ReadonlyMap<string, string>;
  canWrite: boolean;
  /** Accessible table title, e.g. "Products, 25 products shown". */
  caption: string;
}

const href = (p: Product) => `/products/${encodeURIComponent(p.id)}`;
const categoryOf = (p: Product, names: ReadonlyMap<string, string>) =>
  (p.categoryId ? names.get(p.categoryId) : undefined) ?? "-";

function NameLink({ product }: { product: Product }) {
  return (
    <Link
      href={href(product)}
      className="font-medium text-foreground underline-offset-4 hover:underline"
    >
      {product.name}
    </Link>
  );
}

function OpenButton({ product, canWrite }: { product: Product; canWrite: boolean }) {
  return (
    <Button variant="ghost" size="icon-sm" asChild>
      <Link href={href(product)} aria-label={`${canWrite ? "Edit" : "View"} ${product.name}`}>
        {canWrite ? <Pencil aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Link>
    </Button>
  );
}

/** Desktop table (md and up). Mobile uses `ProductCardList`. */
export function ProductTable({ products, categoryNames, canWrite, caption }: ProductTableProps) {
  return (
    <Card className="hidden gap-0 py-0 md:block">
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Product</TableHead>
            <TableHead scope="col">SKU</TableHead>
            <TableHead scope="col">Category</TableHead>
            <TableHead scope="col" className="text-right">
              Price
            </TableHead>
            <TableHead scope="col">Availability</TableHead>
            <TableHead scope="col" className="w-px">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="max-w-72">
                <div className="flex items-center gap-3">
                  <ProductThumb name={p.name} src={p.images[0]?.url} />
                  <div className="min-w-0 truncate">
                    <NameLink product={p} />
                  </div>
                </div>
              </TableCell>
              <TableCell className="font-mono text-xs">{p.sku}</TableCell>
              <TableCell className="text-muted-foreground">
                {categoryOf(p, categoryNames)}
              </TableCell>
              <TableCell className="text-right">
                <PriceDisplay regularMinor={p.regularPriceMinor} saleMinor={p.salePriceMinor} />
              </TableCell>
              <TableCell>
                <AvailabilityBadge availability={p.availability} />
              </TableCell>
              <TableCell>
                <OpenButton product={p} canWrite={canWrite} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/** Mobile card list (below md). */
export function ProductCardList({ products, categoryNames, canWrite, caption }: ProductTableProps) {
  return (
    <ul className="space-y-3 md:hidden" aria-label={caption}>
      {products.map((p) => (
        <li key={p.id}>
          <Card size="sm" className="gap-3">
            <div className="space-y-3 px-4">
              <div className="flex items-start gap-3">
                <ProductThumb name={p.name} src={p.images[0]?.url} size={56} />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="truncate">
                    <NameLink product={p} />
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">{p.sku}</p>
                  <p className="text-xs text-muted-foreground">{categoryOf(p, categoryNames)}</p>
                </div>
                <AvailabilityBadge availability={p.availability} />
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <PriceDisplay regularMinor={p.regularPriceMinor} saleMinor={p.salePriceMinor} />
                <OpenButton product={p} canWrite={canWrite} />
              </div>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
