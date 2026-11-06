import type { Metadata } from "next";
import { Bot } from "lucide-react";

import { ComingLater } from "@/components/dashboard/coming-later";

export const metadata: Metadata = { title: "AI Agents" };

export default function Page() {
  return (
    <ComingLater
      phase={3}
      title="AI Agents"
      icon={Bot}
      description="Configure and monitor the AI agents that answer customers, check stock and prepare orders on your behalf, with their instructions and activity in one place."
    />
  );
}
