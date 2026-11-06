import type { Metadata } from "next";
import { Users } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { PlaceholderCard } from "@/components/dashboard/placeholder-card";

export const metadata: Metadata = { title: "Customers" };

// TEMPORARY stub: replaced by the real customers page in Task 16.
export default function Page() {
  return (
    <div>
      <PageHeader title="Customers" />
      <PlaceholderCard icon={Users}>Customer records, contact details and conversation history will be listed here. This page is being built.</PlaceholderCard>
    </div>
  );
}
