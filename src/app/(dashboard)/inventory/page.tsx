import type { Metadata } from "next";

import { InventoryList } from "@/components/inventory/inventory-list";
import { isLowStockParam } from "@/components/inventory/stock-model";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const ctx = await requireDashboardContext();
  if (!ctx) return null;
  const lowStock = isLowStockParam((await searchParams).lowStock);
  // `key` remounts the list when the param changes (e.g. a link from the overview), so the toggle
  // is re-initialised; afterwards the toggle is the user's own state.
  return <InventoryList key={String(lowStock)} role={ctx.role} initialLowStock={lowStock} />;
}
