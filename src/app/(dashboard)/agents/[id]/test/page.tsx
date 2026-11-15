import type { Metadata } from "next";
import { Lock } from "lucide-react";

import { PlaceholderCard } from "@/components/dashboard/placeholder-card";
import { TestConsole } from "@/components/agents/console/test-console";
import { BackLink } from "@/components/shared/back-link";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";
import { can } from "@/lib/security/permissions";

export const metadata: Metadata = { title: "Test Agent" };

export default async function AgentTestPage({ params }: PageProps<"/agents/[id]">) {
  const { id } = await params;
  const ctx = await requireDashboardContext();
  if (!ctx) return null;

  const canTest = can(ctx.role, "agents:test");
  if (!canTest) {
    return (
      <div className="space-y-4">
        <BackLink href="/agents">All agents</BackLink>
        <PlaceholderCard icon={Lock} heading="You cannot test agents">
          Only owners, admins and sales agents can test agents in the console.
        </PlaceholderCard>
      </div>
    );
  }

  return <TestConsole agentId={id} role={ctx.role} />;
}
