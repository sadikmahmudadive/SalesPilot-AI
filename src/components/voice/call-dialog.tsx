"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, PhoneCall, X } from "lucide-react";
import { toast } from "sonner";

import type { VoiceCall } from "@/schemas/voice";

interface AgentOption {
  id: string;
  name: string;
  role: string;
  status: string;
  channels?: string[];
}

export interface CallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId?: string;
  customerName?: string | null;
  phoneE164?: string | null;
  orderId?: string;
  orderNumber?: string | null;
  consentStatus?: string | null;
  defaultPurpose?: string;
  onSuccess?: (call: VoiceCall) => void;
}

export function CallDialog(props: CallDialogProps) {
  if (!props.open) return null;
  const formKey = `${props.customerId ?? ""}:${props.orderId ?? ""}:${props.phoneE164 ?? ""}`;
  return <CallDialogBody key={formKey} {...props} />;
}

function CallDialogBody({
  onOpenChange,
  customerId,
  customerName,
  phoneE164: initialPhone,
  orderId,
  orderNumber,
  consentStatus,
  defaultPurpose,
  onSuccess,
}: CallDialogProps) {
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [purpose, setPurpose] = useState(
    defaultPurpose ??
      (orderNumber ? `Confirm order #${orderNumber}` : ""),
  );
  const [agentId, setAgentId] = useState("");
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const denied = consentStatus === "denied";

  useEffect(() => {
    let cancelled = false;
    fetch("/api/agents")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled || !json) return;
        const items = (json.items ?? json.data ?? []) as AgentOption[];
        const active = items.filter((a) => a.status === "active");
        setAgents(active);
        const preferred =
          active.find((a) => a.channels?.includes("voice") && a.role === "voice_sales") ??
          active.find((a) => a.channels?.includes("voice")) ??
          active[0];
        if (preferred) setAgentId(preferred.id);
      })
      .catch(() => {
        // Agent list is optional; server resolves a default voice agent if omitted.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (denied) {
      toast.error("Customer has opted out of calls and messages");
      return;
    }
    if (!phone.trim() && !customerId && !orderId) {
      toast.error("Enter a mobile phone number to call");
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {};
      if (phone.trim()) payload.phoneE164 = phone.trim();
      if (customerId) payload.customerId = customerId;
      if (orderId) payload.orderId = orderId;
      if (agentId) payload.agentId = agentId;
      if (purpose.trim()) payload.purpose = purpose.trim();

      const res = await fetch("/api/voice/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || "Failed to initiate AI call");
      }

      toast.success("AI call initiated");
      onSuccess?.(json.data as VoiceCall);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to initiate call");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card text-card-foreground border border-border rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-border/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <PhoneCall className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Start AI Voice Call</h2>
              {(customerName || orderNumber) && (
                <p className="text-xs text-muted-foreground">
                  {[customerName, orderNumber ? `Order #${orderNumber}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {denied && (
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                This customer&apos;s consent status is <strong>Denied</strong>. Outbound AI calls are blocked to respect their opt-out preference.
              </span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              Customer Mobile Number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+8801XXXXXXXXX or 01XXXXXXXXX"
              disabled={denied}
              className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm font-mono disabled:opacity-50"
              required={!customerId && !orderId}
            />
          </div>

          {agents.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">AI Agent</label>
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                disabled={denied}
                className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-50"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.role.replace("_", " ")})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              Call Purpose (injected into agent context)
            </label>
            <input
              type="text"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="e.g., Confirm COD order, follow up on cart, answer sizing question"
              maxLength={200}
              disabled={denied}
              className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-50"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-muted cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || denied}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <PhoneCall className="w-4 h-4" />
              )}
              Place AI Call
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
