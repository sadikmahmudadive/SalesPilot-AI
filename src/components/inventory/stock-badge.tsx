import { CircleAlert, TriangleAlert } from "lucide-react";

import { stockStatus } from "@/components/inventory/stock-model";
import { Badge } from "@/components/ui/badge";

/** "Out of stock" at 0 or less, "Low stock" at the low-stock threshold or below, nothing otherwise. */
export function StockBadge({ available }: { available: number }) {
  const status = stockStatus(available);
  if (status === "ok") return null;
  return status === "out" ? (
    <Badge variant="destructive">
      <CircleAlert aria-hidden="true" />
      Out of stock
    </Badge>
  ) : (
    <Badge variant="secondary">
      <TriangleAlert aria-hidden="true" />
      Low stock
    </Badge>
  );
}
