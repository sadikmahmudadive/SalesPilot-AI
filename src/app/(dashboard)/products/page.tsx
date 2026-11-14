import type { Metadata } from "next";

import { ProductList } from "@/components/products/product-list";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";
import { textParam } from "@/lib/search-param";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The layout guard only runs on hard loads, so data pages verify the session themselves.
  const ctx = await requireDashboardContext();
  if (!ctx) return null;
  // `?q=` (e.g. from the header search's "See all") starts the list with that search.
  const initialSearch = textParam((await searchParams).q);
  return <ProductList key={initialSearch} role={ctx.role} initialSearch={initialSearch} />;
}
