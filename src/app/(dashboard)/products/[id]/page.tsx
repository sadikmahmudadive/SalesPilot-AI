import type { Metadata } from "next";

import { ProductEditor } from "@/components/products/product-editor";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";

export const metadata: Metadata = { title: "Product" };

export default async function ProductPage({ params }: PageProps<"/products/[id]">) {
  const { id } = await params;
  const ctx = await requireDashboardContext();
  if (!ctx) return null;
  return <ProductEditor id={id} role={ctx.role} />;
}
