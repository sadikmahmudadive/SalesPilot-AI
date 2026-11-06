import type { Metadata } from "next";
import { Boxes } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { PlaceholderCard } from "@/components/dashboard/placeholder-card";

export const metadata: Metadata = { title: "Products" };

// TEMPORARY stub: replaced by the real products page in Task 19.
export default function Page() {
  return (
    <div>
      <PageHeader title="Products" />
      <PlaceholderCard icon={Boxes}>Your product catalogue, prices and images will be managed here. This page is being built.</PlaceholderCard>
    </div>
  );
}
