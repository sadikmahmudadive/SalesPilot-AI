import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";

import { ComingLater } from "@/components/dashboard/coming-later";

export const metadata: Metadata = { title: "Analytics" };

export default function Page() {
  return (
    <ComingLater
      phase={8}
      title="Analytics"
      icon={BarChart3}
      description="Sales, response-time and inventory reports based on your real activity will appear here."
    />
  );
}
