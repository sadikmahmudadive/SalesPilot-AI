"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  agentToFormValues,
  applyTemplate,
  buildAgentPatch,
  DEFAULT_AGENT_FORM_VALUES,
  prepareAgentBody,
  type AgentFormValues,
} from "@/components/agents/agent-form-model";
import { AgentFormSections } from "@/components/agents/agent-form-sections";
import { BackLink } from "@/components/shared/back-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCreateAgent, useUpdateAgent } from "@/hooks/use-agents";
import { can, type Role } from "@/lib/security/permissions";
import type { Agent, AgentRole } from "@/schemas/agent";

interface AgentFormProps {
  agent?: Agent;
  canWrite: boolean;
  role: Role;
}

export function AgentForm({ agent, canWrite, role }: AgentFormProps) {
  const router = useRouter();
  const isNew = agent === undefined;

  const [values, setValues] = useState<AgentFormValues>(() => {
    if (agent) return agentToFormValues(agent);
    return applyTemplate(DEFAULT_AGENT_FORM_VALUES, "retail_sales");
  });

  const [baseline, setBaseline] = useState<AgentFormValues>(() => values);
  const [saving, setSaving] = useState(false);

  const createMutation = useCreateAgent();
  const updateMutation = useUpdateAgent(agent?.id ?? "");

  const canTest = can(role, "agents:test");

  const handleChange = (updates: Partial<AgentFormValues>) => {
    setValues((prev) => ({ ...prev, ...updates }));
  };

  const handleRoleChange = (newRole: AgentRole) => {
    if (isNew) {
      setValues((prev) => applyTemplate(prev, newRole));
    } else {
      handleChange({ role: newRole });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite || saving) return;

    setSaving(true);
    try {
      if (isNew) {
        const body = prepareAgentBody(values);
        const created = await createMutation.mutateAsync(body);
        toast.success("Agent created");
        router.push(`/agents/${created.id}`);
      } else {
        const initial = prepareAgentBody(baseline);
        const patch = buildAgentPatch(initial, values);

        if (Object.keys(patch).length === 0) {
          toast.info("No changes to save");
          setSaving(false);
          return;
        }

        const updated = await updateMutation.mutateAsync(patch);
        setBaseline(agentToFormValues(updated));
        setValues(agentToFormValues(updated));
        toast.success(`Agent updated (v${updated.version})`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save agent";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <BackLink href="/agents">All agents</BackLink>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              {isNew ? "New AI Agent" : values.name || "Edit Agent"}
            </h1>
            {!isNew ? (
              <div className="flex items-center gap-1.5">
                <Badge variant={values.status === "active" ? "default" : "secondary"}>
                  {values.status}
                </Badge>
                <Badge variant="outline">v{agent.version}</Badge>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isNew && canTest ? (
            <Button variant="outline" asChild className="gap-1.5">
              <Link href={`/agents/${agent.id}/test`}>
                <FlaskConical className="h-4 w-4" />
                Test in Console
              </Link>
            </Button>
          ) : null}

          {canWrite ? (
            <Button
              onClick={handleSubmit}
              disabled={saving}
              className="gap-1.5"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {isNew ? "Create agent" : "Save changes"}
            </Button>
          ) : null}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <fieldset disabled={!canWrite} className="space-y-6">
          <AgentFormSections
            values={values}
            onChange={handleChange}
            onRoleChange={handleRoleChange}
            disabled={!canWrite}
          />

          {canWrite ? (
            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={saving} className="gap-1.5">
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {isNew ? "Create agent" : "Save changes"}
              </Button>
            </div>
          ) : null}
        </fieldset>
      </form>
    </div>
  );
}
