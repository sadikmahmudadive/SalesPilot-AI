import type { Metadata } from "next";

import { ProductList } from "@/components/products/product-list";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage() {
  // The layout guard only runs on hard loads, so data pages verify the session themselves.
  const ctx = await requireDashboardContext();
  if (!ctx) return null;
  return <ProductList role={ctx.role} />;
}
