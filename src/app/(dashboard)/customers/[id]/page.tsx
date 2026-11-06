import type { Metadata } from "next";

import { CustomerProfile } from "@/components/customers/customer-profile";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const { id } = await params;
  const ctx = await requireDashboardContext();
  if (!ctx) return null;
  return <CustomerProfile id={id} role={ctx.role} />;
}
