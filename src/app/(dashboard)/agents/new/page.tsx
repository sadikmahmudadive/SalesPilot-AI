import type { Metadata } from "next";
import { Lock } from "lucide-react";

import { PlaceholderCard } from "@/components/dashboard/placeholder-card";
import { AgentForm } from "@/components/agents/agent-form";
import { BackLink } from "@/components/shared/back-link";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";
import { can } from "@/lib/security/permissions";

export const metadata: Metadata = { title: "New AI Agent" };

export default async function NewAgentPage() {
  const ctx = await requireDashboardContext();
  if (!ctx) return null;

  const canWrite = can(ctx.role, "agents:write");
  if (!canWrite) {
    return (
      <div className="space-y-4">
        <BackLink href="/agents">All agents</BackLink>
        <PlaceholderCard icon={Lock} heading="You cannot create agents">
          Only owners and admins can configure AI agents. You can still test agents in the console.
        </PlaceholderCard>
      </div>
    );
  }

  return <AgentForm canWrite role={ctx.role} />;
}
