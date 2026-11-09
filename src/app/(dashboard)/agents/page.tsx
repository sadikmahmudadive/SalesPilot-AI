import type { Metadata } from "next";

import { AgentList } from "@/components/agents/agent-list";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";

export const metadata: Metadata = { title: "AI Agents" };

export default async function AgentsPage() {
  const ctx = await requireDashboardContext();
  if (!ctx) return null;
  return <AgentList role={ctx.role} />;
}
