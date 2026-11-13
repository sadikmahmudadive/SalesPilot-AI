"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import {
  ACTION_LABELS,
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  TRIGGER_LABELS,
  type AutomationAction,
  type AutomationRuleSummary,
  type AutomationTemplate,
  type AutomationTrigger,
} from "@/schemas/automation";
import { CUSTOMER_SEGMENTS, type CustomerSegment } from "@/schemas/customer";

interface AutomationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: AutomationRuleSummary | null;
  template: AutomationTemplate | null;
  onSuccess: () => void;
}

const TEMPLATE_VARIABLES = [
  "{{customerName}}",
  "{{orderNumber}}",
  "{{totalBdt}}",
  "{{productName}}",
  "{{phone}}",
] as const;

function AutomationFormBody({
  editing,
  template,
  onClose,
  onSuccess,
}: {
  editing: AutomationRuleSummary | null;
  template: AutomationTemplate | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const initialTrigger: AutomationTrigger =
    editing?.trigger ?? template?.trigger ?? "draft_order_stale";
  const initialAction: AutomationAction =
    editing?.action ?? template?.action ?? "send_whatsapp";

  const [name, setName] = useState(editing?.name ?? template?.name ?? "");
  const [description, setDescription] = useState(
    editing?.description ?? template?.description ?? "",
  );
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);
  const [trigger, setTrigger] = useState<AutomationTrigger>(initialTrigger);
  const [action, setAction] = useState<AutomationAction>(initialAction);

  // Trigger config
  const [delayMinutes, setDelayMinutes] = useState<string>(
    String(editing?.triggerConfig?.delayMinutes ?? template?.triggerConfig?.delayMinutes ?? 30),
  );
  const [inactiveDays, setInactiveDays] = useState<string>(
    String(editing?.triggerConfig?.inactiveDays ?? template?.triggerConfig?.inactiveDays ?? 30),
  );
  const [lowStockThreshold, setLowStockThreshold] = useState<string>(
    String(
      editing?.triggerConfig?.lowStockThreshold ??
        template?.triggerConfig?.lowStockThreshold ??
        5,
    ),
  );

  // Action config
  const [messageTemplate, setMessageTemplate] = useState(
    editing?.actionConfig?.messageTemplate ??
      template?.actionConfig?.messageTemplate ??
      "Hi {{customerName}}, your order #{{orderNumber}} is waiting for confirmation.",
  );
  const [callPurpose, setCallPurpose] = useState(
    editing?.actionConfig?.callPurpose ?? template?.actionConfig?.callPurpose ?? "",
  );
  const [tagsText, setTagsText] = useState(
    (editing?.actionConfig?.addTags ?? template?.actionConfig?.addTags ?? []).join(", "),
  );
  const [segment, setSegment] = useState<"" | CustomerSegment>(
    editing?.actionConfig?.segment ?? template?.actionConfig?.segment ?? "",
  );
  const [webhookUrl, setWebhookUrl] = useState(
    editing?.actionConfig?.webhookUrl ?? template?.actionConfig?.webhookUrl ?? "",
  );
  const [webhookSecret, setWebhookSecret] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Rule name is required");
      return;
    }

    const triggerConfig: Record<string, number> = {};
    if (trigger === "draft_order_stale") {
      const num = Number(delayMinutes);
      if (!Number.isFinite(num) || num < 1) {
        toast.error("Delay minutes must be at least 1");
        return;
      }
      triggerConfig.delayMinutes = Math.round(num);
    } else if (trigger === "customer_inactive") {
      const num = Number(inactiveDays);
      if (!Number.isFinite(num) || num < 1) {
        toast.error("Inactive days must be at least 1");
        return;
      }
      triggerConfig.inactiveDays = Math.round(num);
    } else if (trigger === "inventory_low_stock") {
      const num = Number(lowStockThreshold);
      if (!Number.isFinite(num) || num < 0) {
        toast.error("Low stock threshold must be 0 or greater");
        return;
      }
      triggerConfig.lowStockThreshold = Math.round(num);
    }

    const actionConfig: Record<string, unknown> = {};
    if (action === "send_whatsapp") {
      if (!messageTemplate.trim()) {
        toast.error("WhatsApp message template is required");
        return;
      }
      actionConfig.messageTemplate = messageTemplate.trim();
    } else if (action === "place_voice_call") {
      if (callPurpose.trim()) actionConfig.callPurpose = callPurpose.trim();
    } else if (action === "update_customer") {
      const addTags = tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (addTags.length > 0) actionConfig.addTags = addTags;
      if (segment) actionConfig.segment = segment;
      if (addTags.length === 0 && !segment) {
        toast.error("Provide at least one tag or target segment");
        return;
      }
    } else if (action === "outbound_webhook") {
      if (!webhookUrl.trim()) {
        toast.error("Webhook URL is required");
        return;
      }
      actionConfig.webhookUrl = webhookUrl.trim();
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        enabled,
        trigger,
        triggerConfig,
        action,
        actionConfig,
      };
      if (description.trim()) payload.description = description.trim();
      else if (editing) payload.description = null;

      if (webhookSecret.trim()) {
        payload.webhookSecret = webhookSecret.trim();
      }

      const url = editing ? `/api/automations/${editing.id}` : "/api/automations";
      const method = editing ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || "Failed to save automation rule");
      }

      toast.success(editing ? "Automation rule updated" : "Automation rule created");
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save rule");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card text-card-foreground border border-border rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border/60">
          <h2 className="text-lg font-semibold">
            {editing ? "Edit Automation Rule" : "Create Automation Rule"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Rule Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Abandoned Draft Follow-up"
              maxLength={80}
              required
              className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short note for your team"
              maxLength={300}
              className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm"
            />
          </div>

          {/* When (Trigger) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">When (Trigger)</label>
              <select
                value={trigger}
                onChange={(e) => setTrigger(e.target.value as AutomationTrigger)}
                className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm"
              >
                {AUTOMATION_TRIGGERS.map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Then (Action)</label>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value as AutomationAction)}
                className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm"
              >
                {AUTOMATION_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABELS[a]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Trigger Config */}
          {trigger === "draft_order_stale" && (
            <div className="space-y-1.5 p-3 rounded-xl bg-muted/40 border border-border/50">
              <label className="text-xs font-medium text-foreground">
                Wait Time After Draft Creation (minutes)
              </label>
              <input
                type="number"
                min={1}
                max={10080}
                value={delayMinutes}
                onChange={(e) => setDelayMinutes(e.target.value)}
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm"
              />
            </div>
          )}

          {trigger === "customer_inactive" && (
            <div className="space-y-1.5 p-3 rounded-xl bg-muted/40 border border-border/50">
              <label className="text-xs font-medium text-foreground">
                Days Since Last Customer Interaction
              </label>
              <input
                type="number"
                min={1}
                max={365}
                value={inactiveDays}
                onChange={(e) => setInactiveDays(e.target.value)}
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm"
              />
            </div>
          )}

          {trigger === "inventory_low_stock" && (
            <div className="space-y-1.5 p-3 rounded-xl bg-muted/40 border border-border/50">
              <label className="text-xs font-medium text-foreground">
                Low Stock Alert Threshold (available units &le;)
              </label>
              <input
                type="number"
                min={0}
                max={10000}
                value={lowStockThreshold}
                onChange={(e) => setLowStockThreshold(e.target.value)}
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm"
              />
            </div>
          )}

          {/* Action Config */}
          {action === "send_whatsapp" && (
            <div className="space-y-2 p-3.5 rounded-xl bg-muted/40 border border-border/50">
              <label className="text-xs font-medium text-foreground">
                WhatsApp Message Template
              </label>
              <textarea
                rows={3}
                value={messageTemplate}
                onChange={(e) => setMessageTemplate(e.target.value)}
                maxLength={1000}
                className="w-full rounded-lg border border-input bg-background p-2.5 text-sm"
              />
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_VARIABLES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setMessageTemplate((prev) => `${prev}${prev ? " " : ""}${v}`)}
                    className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-background border border-border hover:border-primary text-muted-foreground hover:text-primary cursor-pointer"
                  >
                    + {v}
                  </button>
                ))}
              </div>
            </div>
          )}

          {action === "place_voice_call" && (
            <div className="space-y-1.5 p-3.5 rounded-xl bg-muted/40 border border-border/50">
              <label className="text-xs font-medium text-foreground">
                AI Call Purpose (optional)
              </label>
              <input
                type="text"
                value={callPurpose}
                onChange={(e) => setCallPurpose(e.target.value)}
                placeholder="e.g., Confirm COD order #{{orderNumber}}"
                maxLength={200}
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm"
              />
            </div>
          )}

          {action === "update_customer" && (
            <div className="space-y-3 p-3.5 rounded-xl bg-muted/40 border border-border/50">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Add Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                  placeholder="vip, follow-up, n8n-synced"
                  className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Move to Segment (optional)
                </label>
                <select
                  value={segment}
                  onChange={(e) => setSegment(e.target.value as "" | CustomerSegment)}
                  className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm capitalize"
                >
                  <option value="">Keep current segment</option>
                  {CUSTOMER_SEGMENTS.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {action === "outbound_webhook" && (
            <div className="space-y-2 p-3.5 rounded-xl bg-muted/40 border border-border/50">
              <label className="text-xs font-medium text-foreground">
                Destination Webhook URL (n8n / Zapier / Custom)
              </label>
              <input
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://your-n8n.example/webhook/salespilot"
                required
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm font-mono"
              />
            </div>
          )}

          {(trigger === "inbound_webhook" || action === "outbound_webhook") && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Webhook Secret ({trigger === "inbound_webhook" ? "x-n8n-secret verification" : "HMAC-SHA256 signing"}
                {editing?.hasWebhookSecret ? " — leave blank to keep current" : ", optional"})
              </label>
              <input
                type="password"
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                placeholder="Shared secret token"
                maxLength={200}
                className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm font-mono"
              />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <span>Rule Enabled</span>
          </label>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/60">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-muted cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {editing ? "Save Changes" : "Create Rule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AutomationFormDialog({
  open,
  onOpenChange,
  editing,
  template,
  onSuccess,
}: AutomationFormDialogProps) {
  if (!open) return null;
  const formKey = editing?.id ?? template?.key ?? "new";
  return (
    <AutomationFormBody
      key={formKey}
      editing={editing}
      template={template}
      onClose={() => onOpenChange(false)}
      onSuccess={onSuccess}
    />
  );
}
