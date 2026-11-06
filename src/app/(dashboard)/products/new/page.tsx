import type { Metadata } from "next";

import { ProductEditor } from "@/components/products/product-editor";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  const ctx = await requireDashboardContext();
  if (!ctx) return null;
  return <ProductEditor role={ctx.role} />;
}
