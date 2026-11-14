import type { Metadata } from "next";

import { OrderList } from "@/components/orders/order-list";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";
import { textParam } from "@/lib/search-param";

export const metadata: Metadata = { title: "Orders" };

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The layout guard only runs on hard loads, so data pages verify the session themselves.
  const ctx = await requireDashboardContext();
  if (!ctx) return null;
  // `?q=` (e.g. from the header search's "See all") starts the list with that search.
  const initialSearch = textParam((await searchParams).q);
  return <OrderList key={initialSearch} role={ctx.role} initialSearch={initialSearch} />;
}
