"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Copy,
  Edit,
  History,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Workflow,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { AutomationFormDialog } from "@/components/automations/automation-form-dialog";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { can, type Role } from "@/lib/security/permissions";
import {
  ACTION_LABELS,
  AUTOMATION_TEMPLATES,
  TRIGGER_LABELS,
  type AutomationRuleSummary,
  type AutomationRun,
  type AutomationTemplate,
} from "@/schemas/automation";

function runBadgeVariant(status: AutomationRun["status"]): "default" | "destructive" | "secondary" {
  if (status === "succeeded") return "default";
  if (status === "failed") return "destructive";
  return "secondary";
}

export function AutomationsConsole({ role }: { role: Role }) {
  const canWrite = can(role, "automations:write");
  const [activeTab, setActiveTab] = useState<"rules" | "runs">("rules");
  const [rules, setRules] = useState<AutomationRuleSummary[]>([]);
  const [templates, setTemplates] = useState<readonly AutomationTemplate[]>(AUTOMATION_TEMPLATES);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [sweeping, setSweeping] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRuleSummary | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<AutomationTemplate | null>(null);
  const [runningRuleId, setRunningRuleId] = useState<string | null>(null);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, runsRes] = await Promise.all([
        fetch("/api/automations"),
        fetch("/api/automations/runs?limit=50"),
      ]);
      if (rulesRes.ok) {
        const json = await rulesRes.json();
        setRules(json.items ?? []);
        if (Array.isArray(json.templates) && json.templates.length > 0) {
          setTemplates(json.templates);
        }
      }
      if (runsRes.ok) {
        const json = await runsRes.json();
        setRuns(json.items ?? []);
      }
    } catch {
      toast.error("Failed to load automations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadInitial() {
      try {
        const [rulesRes, runsRes] = await Promise.all([
          fetch("/api/automations"),
          fetch("/api/automations/runs?limit=50"),
        ]);
        if (cancelled) return;
        if (rulesRes.ok) {
          const json = await rulesRes.json();
          setRules(json.items ?? []);
          if (Array.isArray(json.templates) && json.templates.length > 0) {
            setTemplates(json.templates);
          }
        }
        if (runsRes.ok) {
          const json = await runsRes.json();
          setRuns(json.items ?? []);
        }
      } catch {
        if (!cancelled) toast.error("Failed to load automations");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const activeRules = rules.filter((r) => r.enabled).length;
    const totalRuns = rules.reduce((acc, r) => acc + (r.stats?.totalRuns ?? 0), 0);
    const succeededRuns = rules.reduce((acc, r) => acc + (r.stats?.succeededRuns ?? 0), 0);
    const skippedRuns = rules.reduce((acc, r) => acc + (r.stats?.skippedRuns ?? 0), 0);
    return { activeRules, totalRuns, succeededRuns, skippedRuns };
  }, [rules]);

  const handleOpenNew = () => {
    setEditingRule(null);
    setSelectedTemplate(null);
    setDialogOpen(true);
  };

  const handleUseTemplate = (tpl: AutomationTemplate) => {
    setEditingRule(null);
    setSelectedTemplate(tpl);
    setDialogOpen(true);
  };

  const handleEdit = (rule: AutomationRuleSummary) => {
    setSelectedTemplate(null);
    setEditingRule(rule);
    setDialogOpen(true);
  };

  const handleToggleEnabled = async (rule: AutomationRuleSummary) => {
    try {
      const res = await fetch(`/api/automations/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      if (!res.ok) throw new Error("Failed to toggle rule");
      toast.success(rule.enabled ? "Rule paused" : "Rule enabled");
      void refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update rule");
    }
  };

  const handleDelete = async (rule: AutomationRuleSummary) => {
    if (!confirm(`Delete automation rule "${rule.name}"?`)) return;
    try {
      const res = await fetch(`/api/automations/${rule.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete rule");
      toast.success("Rule deleted");
      void refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete rule");
    }
  };

  const handleTestTrigger = async (rule: AutomationRuleSummary) => {
    setRunningRuleId(rule.id);
    try {
      const res = await fetch(`/api/automations/${rule.id}/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Test run failed");
      const run = json.data as AutomationRun;
      toast.success(`Test run finished (${run.status}): ${run.summary}`);
      void refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to trigger rule");
    } finally {
      setRunningRuleId(null);
    }
  };

  const handleRunSweep = async () => {
    setSweeping(true);
    try {
      const res = await fetch("/api/automations/runs", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Sweep failed");
      const data = json.data as { evaluated: number; succeeded: number; skipped: number; failed: number };
      toast.success(
        `Sweep done: ${data.evaluated} evaluated (${data.succeeded} succeeded, ${data.skipped} skipped)`,
      );
      void refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run sweep");
    } finally {
      setSweeping(false);
    }
  };

  const handleCopyWebhook = async (relativeUrl: string) => {
    const fullUrl =
      typeof window !== "undefined" ? `${window.location.origin}${relativeUrl}` : relativeUrl;
    await navigator.clipboard.writeText(fullUrl);
    toast.success("Inbound webhook URL copied");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Follow-ups & Automations"
        description="Automated customer follow-ups, low-stock alerts, CRM tagging, and signed n8n webhooks."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refreshAll()}
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {canWrite && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRunSweep()}
                  disabled={sweeping}
                >
                  {sweeping ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <Zap className="w-4 h-4 mr-1.5" />
                  )}
                  Run Sweep Now
                </Button>
                <Button size="sm" onClick={handleOpenNew}>
                  <Plus className="w-4 h-4 mr-1.5" />
                  New Automation Rule
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <p className="text-xs text-muted-foreground">Active Rules</p>
          <p className="text-2xl font-bold mt-1">{stats.activeRules}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <p className="text-xs text-muted-foreground">Total Executions</p>
          <p className="text-2xl font-bold mt-1">{stats.totalRuns}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <p className="text-xs text-muted-foreground">Succeeded</p>
          <p className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
            {stats.succeededRuns}
          </p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <p className="text-xs text-muted-foreground">Skipped (Opt-Out / Empty)</p>
          <p className="text-2xl font-bold mt-1">{stats.skippedRuns}</p>
        </div>
      </div>

      {/* Quick-Start Templates */}
      {canWrite && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            Quick-Start Templates
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {templates.map((tpl) => (
              <button
                key={tpl.key}
                type="button"
                onClick={() => handleUseTemplate(tpl)}
                className="text-left rounded-xl border border-border/60 bg-card p-3.5 hover:border-primary/60 hover:bg-primary/5 transition-all space-y-1.5 cursor-pointer"
              >
                <div className="font-semibold text-xs text-foreground line-clamp-1">
                  {tpl.name}
                </div>
                <p className="text-[11px] text-muted-foreground line-clamp-2">{tpl.description}</p>
                <div className="pt-1 text-[10px] font-medium text-primary">
                  + Use Template
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border/60 pb-1">
        <button
          type="button"
          onClick={() => setActiveTab("rules")}
          className={`px-4 py-2 text-sm font-semibold rounded-t-xl transition-all flex items-center gap-2 cursor-pointer border-b-2 -mb-1 ${
            activeTab === "rules"
              ? "border-primary text-primary bg-primary/5"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Workflow className="w-4 h-4" />
          Rules ({rules.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("runs")}
          className={`px-4 py-2 text-sm font-semibold rounded-t-xl transition-all flex items-center gap-2 cursor-pointer border-b-2 -mb-1 ${
            activeTab === "runs"
              ? "border-primary text-primary bg-primary/5"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <History className="w-4 h-4" />
          Run History ({runs.length})
        </button>
      </div>

      {loading ? (
        <div className="p-12 text-center rounded-xl border border-dashed border-border/60">
          <Loader2 className="w-7 h-7 mx-auto animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-2">Loading automations...</p>
        </div>
      ) : activeTab === "rules" ? (
        rules.length === 0 ? (
          <div className="p-12 text-center rounded-xl border border-dashed border-border/60 space-y-3">
            <div className="w-11 h-11 mx-auto rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Workflow className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">No automation rules configured</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                Click any quick-start template above or create a custom follow-up rule to get started.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="rounded-2xl border border-border/60 bg-card p-5 space-y-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm text-foreground">{rule.name}</h3>
                      <Badge variant={rule.enabled ? "default" : "secondary"} className="text-[10px]">
                        {rule.enabled ? "Active" : "Paused"}
                      </Badge>
                    </div>
                    {rule.description && (
                      <p className="text-xs text-muted-foreground">{rule.description}</p>
                    )}
                  </div>

                  {canWrite && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleEdit(rule)}
                        className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                        title="Edit rule"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(rule)}
                        className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive cursor-pointer"
                        title="Delete rule"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline">{TRIGGER_LABELS[rule.trigger]}</Badge>
                  <span className="text-muted-foreground">&rarr;</span>
                  <Badge variant="secondary">{ACTION_LABELS[rule.action]}</Badge>
                </div>

                {rule.trigger === "inbound_webhook" && (
                  <div className="p-2.5 rounded-xl bg-muted/50 border border-border/40 space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>n8n Inbound Trigger URL</span>
                      <button
                        type="button"
                        onClick={() => void handleCopyWebhook(rule.inboundWebhookUrl)}
                        className="inline-flex items-center gap-1 text-primary hover:underline font-medium cursor-pointer"
                      >
                        <Copy className="size-3" /> Copy
                      </button>
                    </div>
                    <p className="text-[11px] font-mono text-muted-foreground break-all bg-background/80 p-1.5 rounded border border-border/30">
                      {rule.inboundWebhookUrl}
                    </p>
                  </div>
                )}

                <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    {rule.stats.succeededRuns} succeeded / {rule.stats.totalRuns} total
                  </span>

                  {canWrite && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleToggleEnabled(rule)}
                        className="px-2.5 py-1 rounded-lg border border-border hover:bg-muted text-foreground font-medium cursor-pointer"
                      >
                        {rule.enabled ? "Pause" : "Enable"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleTestTrigger(rule)}
                        disabled={runningRuleId === rule.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border hover:bg-muted text-foreground font-medium cursor-pointer disabled:opacity-50"
                      >
                        {runningRuleId === rule.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Play className="w-3 h-3" />
                        )}
                        Test
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : runs.length === 0 ? (
        <div className="p-12 text-center rounded-xl border border-dashed border-border/60 text-xs text-muted-foreground">
          No automation runs recorded yet.
        </div>
      ) : (
        <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground border-b border-border/60">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Rule</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                  <th className="text-left font-medium px-4 py-3">Target</th>
                  <th className="text-left font-medium px-4 py-3">Summary</th>
                  <th className="text-right font-medium px-4 py-3">Executed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {runs.map((run) => (
                  <tr key={run.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground text-xs">{run.ruleName}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {TRIGGER_LABELS[run.trigger]} &rarr; {ACTION_LABELS[run.action]}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={runBadgeVariant(run.status)} className="capitalize text-xs">
                        {run.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                      {run.targetType}
                      {run.targetId ? `:${run.targetId.slice(0, 10)}` : ""}
                    </td>
                    <td className="px-4 py-3 text-xs text-foreground max-w-md">{run.summary}</td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(run.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AutomationFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editingRule}
        template={selectedTemplate}
        onSuccess={() => void refreshAll()}
      />
    </div>
  );
}
