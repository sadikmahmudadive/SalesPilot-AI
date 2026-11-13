"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Clock,
  Loader2,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  RefreshCw,
  Save,
  Volume2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/dashboard/page-header";
import { CallDialog } from "@/components/voice/call-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { can, type Role } from "@/lib/security/permissions";
import {
  CALL_DIRECTIONS,
  CALL_OUTCOMES,
  CALL_STATUSES,
  type CallDirection,
  type CallOutcome,
  type CallStatus,
  type VoiceCall,
} from "@/schemas/voice";

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function statusVariant(status: CallStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "failed" || status === "canceled") return "destructive";
  if (status === "in_progress" || status === "ringing" || status === "queued") return "secondary";
  return "outline";
}

function outcomeLabel(outcome: CallOutcome): string {
  return outcome.replace(/_/g, " ");
}

export function VoiceConsole({ role }: { role: Role }) {
  const canWrite = can(role, "voice:write");
  const [calls, setCalls] = useState<VoiceCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [directionFilter, setDirectionFilter] = useState<"" | CallDirection>("");
  const [statusFilter, setStatusFilter] = useState<"" | CallStatus>("");
  const [selected, setSelected] = useState<VoiceCall | null>(null);
  const [callDialogOpen, setCallDialogOpen] = useState(false);

  // Detail edit state
  const [editOutcome, setEditOutcome] = useState<CallOutcome>("unknown");
  const [editNotes, setEditNotes] = useState("");
  const [savingDetail, setSavingDetail] = useState(false);

  const loadCalls = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (directionFilter) qs.set("direction", directionFilter);
      if (statusFilter) qs.set("status", statusFilter);
      qs.set("limit", "100");
      const res = await fetch(`/api/voice/calls?${qs.toString()}`);
      if (!res.ok) throw new Error("Failed to load voice calls");
      const json = await res.json();
      const items = (json.items ?? []) as VoiceCall[];
      setCalls(items);
      setSelected((prev) =>
        prev ? (items.find((c) => c.id === prev.id) ?? prev) : null,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load calls");
    } finally {
      setLoading(false);
    }
  }, [directionFilter, statusFilter]);

  useEffect(() => {
    let cancelled = false;
    async function fetchInitial() {
      try {
        const qs = new URLSearchParams();
        if (directionFilter) qs.set("direction", directionFilter);
        if (statusFilter) qs.set("status", statusFilter);
        qs.set("limit", "100");
        const res = await fetch(`/api/voice/calls?${qs.toString()}`);
        if (!res.ok) throw new Error("Failed to load voice calls");
        const json = await res.json();
        const items = (json.items ?? []) as VoiceCall[];
        if (!cancelled) {
          setCalls(items);
          setSelected((prev) =>
            prev ? (items.find((c) => c.id === prev.id) ?? prev) : null,
          );
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load calls");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void fetchInitial();
    return () => {
      cancelled = true;
    };
  }, [directionFilter, statusFilter]);

  const selectCall = (call: VoiceCall) => {
    setSelected(call);
    setEditOutcome(call.outcome);
    setEditNotes(call.notes ?? "");
  };

  const handleSaveDetail = async () => {
    if (!selected) return;
    setSavingDetail(true);
    try {
      const res = await fetch(`/api/voice/calls/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome: editOutcome,
          notes: editNotes.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Failed to update call");
      const updated = json.data as VoiceCall;
      setCalls((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setSelected(updated);
      toast.success("Call outcome & notes saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingDetail(false);
    }
  };

  const stats = useMemo(() => {
    const total = calls.length;
    const completed = calls.filter((c) => c.status === "completed").length;
    const totalDur = calls.reduce((acc, c) => acc + (c.durationSeconds ?? 0), 0);
    const avgDuration = completed > 0 ? Math.round(totalDur / completed) : 0;
    const conversions = calls.filter(
      (c) => c.outcome === "order_confirmed" || c.outcome === "sale_drafted",
    ).length;
    return { total, completed, avgDuration, conversions };
  }, [calls]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Voice Calls"
        description="AI-powered inbound and outbound customer calls, transcripts, recordings, and outcomes."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadCalls()}
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {canWrite && (
              <Button size="sm" onClick={() => setCallDialogOpen(true)}>
                <PhoneCall className="w-4 h-4 mr-1.5" />
                New AI Call
              </Button>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <p className="text-xs text-muted-foreground">Total Calls</p>
          <p className="text-2xl font-bold mt-1">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <p className="text-xs text-muted-foreground">Completed</p>
          <p className="text-2xl font-bold mt-1">{stats.completed}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <p className="text-xs text-muted-foreground">Avg Duration</p>
          <p className="text-2xl font-bold mt-1">{formatDuration(stats.avgDuration)}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <p className="text-xs text-muted-foreground">Orders / Drafts</p>
          <p className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
            {stats.conversions}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={directionFilter}
          onChange={(e) => setDirectionFilter(e.target.value as "" | CallDirection)}
          aria-label="Filter by direction"
          className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
        >
          <option value="">All Directions</option>
          {CALL_DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | CallStatus)}
          aria-label="Filter by status"
          className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
        >
          <option value="">All Statuses</option>
          {CALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      {/* Main Content: Table + Detail Drawer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className={selected ? "lg:col-span-7" : "lg:col-span-12"}>
          {loading ? (
            <div className="p-12 text-center rounded-xl border border-dashed border-border/60">
              <Loader2 className="w-7 h-7 mx-auto animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground mt-2">Loading call logs...</p>
            </div>
          ) : calls.length === 0 ? (
            <div className="p-12 text-center rounded-xl border border-dashed border-border/60 space-y-3">
              <div className="w-11 h-11 mx-auto rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Phone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">No voice calls yet</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                  Connect Vapi or Twilio in{" "}
                  <Link href="/integrations" className="text-primary underline">
                    Integrations
                  </Link>{" "}
                  and place your first AI call.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground border-b border-border/60">
                    <tr>
                      <th className="text-left font-medium px-4 py-3">Contact</th>
                      <th className="text-left font-medium px-4 py-3">Direction</th>
                      <th className="text-left font-medium px-4 py-3">Status</th>
                      <th className="text-left font-medium px-4 py-3">Outcome</th>
                      <th className="text-right font-medium px-4 py-3">Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {calls.map((c) => {
                      const isSelected = selected?.id === c.id;
                      return (
                        <tr
                          key={c.id}
                          onClick={() => selectCall(c)}
                          className={`cursor-pointer transition-colors hover:bg-muted/40 ${
                            isSelected ? "bg-primary/5" : ""
                          }`}
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium text-foreground">
                              {c.customerName ?? c.phoneE164}
                            </div>
                            <div className="text-xs text-muted-foreground font-mono">
                              {c.phoneE164}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1 text-xs capitalize text-muted-foreground">
                              {c.direction === "outbound" ? (
                                <PhoneOutgoing className="w-3.5 h-3.5 text-primary" />
                              ) : (
                                <PhoneIncoming className="w-3.5 h-3.5 text-emerald-600" />
                              )}
                              {c.direction}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={statusVariant(c.status)} className="capitalize text-xs">
                              {c.status.replace(/_/g, " ")}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-xs capitalize text-muted-foreground">
                            {outcomeLabel(c.outcome)}
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatDuration(c.durationSeconds)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selected && (
          <div className="lg:col-span-5 rounded-xl border border-border/60 bg-card p-5 space-y-4">
            <div className="flex items-start justify-between gap-2 border-b border-border/50 pb-3">
              <div>
                <h3 className="font-semibold text-base">
                  {selected.customerName ?? selected.phoneE164}
                </h3>
                <p className="text-xs text-muted-foreground font-mono">
                  {selected.phoneE164} &bull; {selected.provider.toUpperCase()}
                </p>
                <div className="flex flex-wrap gap-2 mt-2 text-xs">
                  {selected.customerId && (
                    <Link
                      href={`/customers/${selected.customerId}`}
                      className="text-primary hover:underline"
                    >
                      View Customer
                    </Link>
                  )}
                  {selected.orderId && (
                    <Link
                      href={`/orders/${selected.orderId}`}
                      className="text-primary hover:underline"
                    >
                      View Order
                    </Link>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="p-1 rounded-lg hover:bg-muted text-muted-foreground cursor-pointer"
                aria-label="Close details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {selected.purpose && (
              <div className="text-xs">
                <span className="font-medium text-muted-foreground">Purpose: </span>
                <span>{selected.purpose}</span>
              </div>
            )}

            {selected.recordingUrl && (
              <div className="space-y-1.5 p-3 rounded-lg bg-muted/40 border border-border/40">
                <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <Volume2 className="w-3.5 h-3.5 text-primary" />
                  Call Recording
                </div>
                <audio controls src={selected.recordingUrl} className="w-full h-9" />
              </div>
            )}

            {selected.summary && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">AI Summary</p>
                <p className="text-sm bg-muted/30 p-3 rounded-lg border border-border/40">
                  {selected.summary}
                </p>
              </div>
            )}

            {/* Transcript */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Transcript ({selected.transcript.length})
              </p>
              {selected.transcript.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  No transcript recorded yet.
                </p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {selected.transcript.map((entry, idx) => (
                    <div
                      key={idx}
                      className={`p-2.5 rounded-lg text-xs ${
                        entry.role === "assistant"
                          ? "bg-primary/10 text-foreground ml-4"
                          : entry.role === "user"
                            ? "bg-muted text-foreground mr-4"
                            : "bg-muted/40 text-muted-foreground text-center"
                      }`}
                    >
                      <span className="font-semibold capitalize block mb-0.5 text-[10px] text-muted-foreground">
                        {entry.role}
                      </span>
                      {entry.text}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Outcome & Notes */}
            <div className="space-y-3 pt-3 border-t border-border/50">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Outcome</label>
                <select
                  value={editOutcome}
                  onChange={(e) => setEditOutcome(e.target.value as CallOutcome)}
                  disabled={!canWrite}
                  className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm capitalize"
                >
                  {CALL_OUTCOMES.map((o) => (
                    <option key={o} value={o}>
                      {outcomeLabel(o)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Notes</label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  disabled={!canWrite}
                  rows={2}
                  placeholder="Internal follow-up notes..."
                  className="w-full rounded-lg border border-input bg-background p-2.5 text-sm resize-none"
                />
              </div>

              {canWrite && (
                <Button
                  size="sm"
                  onClick={() => void handleSaveDetail()}
                  disabled={savingDetail}
                  className="w-full"
                >
                  {savingDetail ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-1.5" />
                  )}
                  Save Outcome & Notes
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <CallDialog
        open={callDialogOpen}
        onOpenChange={setCallDialogOpen}
        onSuccess={(newCall) => {
          setCalls((prev) => [newCall, ...prev]);
          selectCall(newCall);
        }}
      />
    </div>
  );
}
