import type { Metadata } from "next";

import { CustomerList } from "@/components/customers/customer-list";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";
import { textParam } from "@/lib/search-param";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The layout guard only runs on hard loads, so data pages verify the session themselves.
  const ctx = await requireDashboardContext();
  if (!ctx) return null;
  // `?q=` (e.g. from the header search's "See all") starts the list with that search.
  const initialSearch = textParam((await searchParams).q);
  return <CustomerList key={initialSearch} role={ctx.role} initialSearch={initialSearch} />;
}
