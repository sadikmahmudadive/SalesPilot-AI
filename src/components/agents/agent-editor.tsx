"use client";

import { Bot } from "lucide-react";

import { PlaceholderCard } from "@/components/dashboard/placeholder-card";
import { AgentForm } from "@/components/agents/agent-form";
import { BackLink } from "@/components/shared/back-link";
import { QueryErrorState } from "@/components/shared/query-error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgent } from "@/hooks/use-agents";
import { ApiError } from "@/lib/api/client";
import { can, type Role } from "@/lib/security/permissions";

function EditorSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}

export function AgentEditor({ id, role }: { id: string; role: Role }) {
  const canWrite = can(role, "agents:write");
  const query = useAgent(id);
  const agent = query.data;

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <BackLink href="/agents">All agents</BackLink>
        <p className="sr-only" role="status">
          Loading agent
        </p>
        <EditorSkeleton />
      </div>
    );
  }

  if (!agent) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="space-y-4">
        <BackLink href="/agents">All agents</BackLink>
        {notFound ? (
          <PlaceholderCard icon={Bot} heading="Agent not found">
            This AI agent may have been removed, or the link is incorrect.
          </PlaceholderCard>
        ) : (
          <QueryErrorState
            title="This agent could not be loaded"
            error={query.error}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        )}
      </div>
    );
  }

  return <AgentForm key={agent.id} agent={agent} canWrite={canWrite} role={role} />;
}
