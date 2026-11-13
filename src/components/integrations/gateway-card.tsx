"use client";

import { useState } from "react";
import { Check, CheckCircle2, CreditCard, Edit, Loader2, Play, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";

import type { GatewayAccountSummary } from "@/schemas/integration";

interface GatewayCardProps {
  gateway: GatewayAccountSummary;
  onEdit: (gateway: GatewayAccountSummary) => void;
  onRefresh: () => void;
}

export function GatewayCard({ gateway, onEdit, onRefresh }: GatewayCardProps) {
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch(`/api/integrations/gateways/${gateway.id}/test`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success("Gateway connection verified successfully");
        onRefresh();
      } else {
        toast.error(data.error || "Connection test failed");
        onRefresh();
      }
    } catch {
      toast.error("Network error testing gateway");
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete gateway "${gateway.label}"?`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/integrations/gateways/${gateway.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Gateway account deleted");
        onRefresh();
      } else {
        const data = await res.json();
        toast.error(data.error?.message || "Failed to delete gateway");
      }
    } catch {
      toast.error("Network error deleting gateway");
    } finally {
      setDeleting(false);
    }
  };

  const handleSetDefault = async () => {
    try {
      const res = await fetch(`/api/integrations/gateways/${gateway.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      if (res.ok) {
        toast.success(`"${gateway.label}" is now the default gateway`);
        onRefresh();
      } else {
        toast.error("Failed to set as default");
      }
    } catch {
      toast.error("Network error");
    }
  };

  return (
    <div className="bg-card text-card-foreground rounded-2xl border border-border/50 p-5 shadow-sm hover:shadow transition-all space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
            <CreditCard className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
              {gateway.label}
              {gateway.isDefault && (
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  Default
                </span>
              )}
            </h3>
            <p className="text-xs text-muted-foreground capitalize mt-0.5">
              Provider: {gateway.provider} &bull; Mode:{" "}
              <span className="font-medium text-foreground uppercase text-[11px]">{gateway.mode}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onEdit(gateway)}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors cursor-pointer"
            title="Edit configuration"
          >
            <Edit className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg hover:bg-destructive/10 transition-colors cursor-pointer disabled:opacity-50"
            title="Delete gateway"
          >
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Status & Health */}
      <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Status:</span>
          {gateway.enabled ? (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Active
            </span>
          ) : (
            <span className="text-muted-foreground">Disabled</span>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-muted-foreground">
          {gateway.lastTestResult === "ok" ? (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" /> Connected
            </span>
          ) : gateway.lastTestResult === "failed" ? (
            <span className="inline-flex items-center gap-1 text-destructive">
              <XCircle className="w-3.5 h-3.5" /> Test Failed
            </span>
          ) : (
            <span>Not tested yet</span>
          )}
        </div>
      </div>

      {/* Footer Controls */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="flex-1 py-2 px-3 rounded-xl border border-border/60 hover:bg-muted text-xs font-medium text-foreground transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          Test Connection
        </button>

        {!gateway.isDefault && (
          <button
            type="button"
            onClick={handleSetDefault}
            className="py-2 px-3 rounded-xl border border-border/60 hover:bg-muted text-xs font-medium text-muted-foreground hover:text-foreground transition-all flex items-center gap-1 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" /> Make Default
          </button>
        )}
      </div>
    </div>
  );
}
