import type { Metadata } from "next";

import { InventoryList } from "@/components/inventory/inventory-list";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage() {
  const ctx = await requireDashboardContext();
  if (!ctx) return null;
  return <InventoryList role={ctx.role} />;
}
