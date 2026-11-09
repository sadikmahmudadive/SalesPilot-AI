"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Bot, FlaskConical, Pencil, Plus, Sparkles } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { PlaceholderCard } from "@/components/dashboard/placeholder-card";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PagedListView } from "@/components/shared/paged-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AGENT_LANGUAGE_LABELS, AGENT_ROLE_LABELS } from "@/config/agent-labels";
import { useAgents } from "@/hooks/use-agents";
import { formatDate } from "@/lib/format";
import { can, type Role } from "@/lib/security/permissions";
import { AGENT_ROLES, type Agent } from "@/schemas/agent";
import { AGENT_TEMPLATES } from "@/services/agents/templates";

const NOUN = { singular: "agent", plural: "agents" };

export function AgentList({ role }: { role: Role }) {
  const canWrite = can(role, "agents:write");
  const canTest = can(role, "agents:test");

  const query = useAgents();
  const agents = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  const empty = (
    <div className="space-y-6">
      <PlaceholderCard icon={Bot} heading="No AI agents yet">
        {canWrite
          ? "Create an agent from a role template below to start grounding answers in your real catalog and stock."
          : "Agents created by your team will appear here."}
      </PlaceholderCard>

      {canWrite ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Get started with a template
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {AGENT_ROLES.map((r) => {
              const tmpl = AGENT_TEMPLATES[r];
              return (
                <Card key={r} className="flex flex-col justify-between hover:border-primary/50 transition-colors">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-medium">
                        {AGENT_ROLE_LABELS[r]}
                      </CardTitle>
                      <Sparkles className="h-4 w-4 text-primary" />
                    </div>
                    <CardDescription className="text-xs line-clamp-3">
                      {tmpl.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <Button asChild variant="outline" size="sm" className="w-full">
                      <Link href="/agents/new">Use template</Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Agents"
        description="Configure and test conversational agents grounded in your real catalog, stock and customer data."
        actions={
          canWrite ? (
            <Button asChild className="gap-1.5">
              <Link href="/agents/new">
                <Plus className="h-4 w-4" />
                New agent
              </Link>
            </Button>
          ) : null
        }
      />

      <PagedListView
        query={query}
        items={agents}
        noun={NOUN}
        skeleton={<ListSkeleton />}
        empty={empty}
      >
        {(rows: readonly Agent[]) => (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Languages</TableHead>
                  <TableHead>Tools</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((agent) => (
                  <TableRow key={agent.id}>
                    <TableCell>
                      <div className="space-y-0.5">
                        <Link
                          href={`/agents/${agent.id}`}
                          className="font-medium hover:underline"
                        >
                          {agent.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {AGENT_ROLE_LABELS[agent.role]}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={agent.status === "active" ? "default" : "secondary"}
                        className="capitalize"
                      >
                        {agent.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">v{agent.version}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {agent.languages.map((l) => AGENT_LANGUAGE_LABELS[l]).join(", ")}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {agent.tools.length} {agent.tools.length === 1 ? "tool" : "tools"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(agent.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {canTest ? (
                          <Button asChild variant="outline" size="sm" className="h-8 gap-1">
                            <Link href={`/agents/${agent.id}/test`}>
                              <FlaskConical className="h-3.5 w-3.5" />
                              Test
                            </Link>
                          </Button>
                        ) : null}
                        <Button asChild variant="ghost" size="sm" className="h-8 gap-1">
                          <Link href={`/agents/${agent.id}`}>
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </PagedListView>
    </div>
  );
}
