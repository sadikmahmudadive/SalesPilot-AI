import type { Metadata } from "next";
import { PackageSearch } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { PlaceholderCard } from "@/components/dashboard/placeholder-card";

export const metadata: Metadata = { title: "Inventory" };

// TEMPORARY stub: replaced by the real inventory page in Task 19.
export default function Page() {
  return (
    <div>
      <PageHeader title="Inventory" />
      <PlaceholderCard icon={PackageSearch}>Stock levels and adjustments for each product will be tracked here. This page is being built.</PlaceholderCard>
    </div>
  );
}
