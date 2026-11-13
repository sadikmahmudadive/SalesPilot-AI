import type { Metadata } from "next";

import { OrderDetailView } from "@/components/orders/order-detail";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";

export const metadata: Metadata = { title: "Order" };

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const ctx = await requireDashboardContext();
  if (!ctx) return null;
  return <OrderDetailView id={id} role={ctx.role} />;
}
