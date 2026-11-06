import type { Metadata } from "next";
import { Workflow } from "lucide-react";

import { ComingLater } from "@/components/dashboard/coming-later";

export const metadata: Metadata = { title: "Automations" };

export default function Page() {
  return (
    <ComingLater
      phase={7}
      title="Automations"
      icon={Workflow}
      description="Rules that follow up with customers, restock reminders and routine tasks will be built and monitored here."
    />
  );
}
