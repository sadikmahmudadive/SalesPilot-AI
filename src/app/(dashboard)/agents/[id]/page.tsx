import type { Metadata } from "next";

import { AgentEditor } from "@/components/agents/agent-editor";
import { requireDashboardContext } from "@/lib/auth/dashboard-context";

export const metadata: Metadata = { title: "Agent" };

export default async function AgentPage({ params }: PageProps<"/agents/[id]">) {
  const { id } = await params;
  const ctx = await requireDashboardContext();
  if (!ctx) return null;
  return <AgentEditor id={id} role={ctx.role} />;
}
