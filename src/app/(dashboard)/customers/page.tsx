import type { Metadata } from "next";

import { CustomerList } from "@/components/customers/customer-list";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage() {
  // The layout guard only runs on hard loads, so data pages verify the session themselves.
  const ctx = await requireDashboardContext();
  if (!ctx) return null;
  return <CustomerList role={ctx.role} />;
}
