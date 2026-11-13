import type { Metadata } from "next";

import { OrderList } from "@/components/orders/order-list";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";

export const metadata: Metadata = { title: "Orders" };

export default async function OrdersPage() {
  // The layout guard only runs on hard loads, so data pages verify the session themselves.
  const ctx = await requireDashboardContext();
  if (!ctx) return null;
  return <OrderList role={ctx.role} />;
}
