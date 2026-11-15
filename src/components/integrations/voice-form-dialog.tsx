"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import type { IntegrationMode } from "@/schemas/integration";
import type { VoiceAccountSummary, VoiceProvider } from "@/schemas/voice";

interface VoiceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: VoiceAccountSummary | null;
  onSuccess: () => void;
}

function VoiceFormBody({
  editing,
  onClose,
  onSuccess,
}: {
  editing: VoiceAccountSummary | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [provider, setProvider] = useState<VoiceProvider>(editing?.provider ?? "vapi");
  const [label, setLabel] = useState(editing?.label ?? "");
  const [mode, setMode] = useState<IntegrationMode>(
    editing?.mode ?? (provider === "mock" ? "mock" : "live"),
  );
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);
  const [isDefault, setIsDefault] = useState(editing?.isDefault ?? false);

  // Vapi credentials & config
  const [apiKey, setApiKey] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState(
    typeof editing?.publicConfig?.phoneNumberId === "string"
      ? editing.publicConfig.phoneNumberId
      : "",
  );
  const [assistantId, setAssistantId] = useState(
    typeof editing?.publicConfig?.assistantId === "string"
      ? editing.publicConfig.assistantId
      : "",
  );

  // Twilio credentials & config
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [fromNumber, setFromNumber] = useState(
    typeof editing?.publicConfig?.fromNumber === "string"
      ? editing.publicConfig.fromNumber
      : "",
  );

  const [webhookSecret, setWebhookSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) {
      toast.error("Account label is required");
      return;
    }

    setSubmitting(true);
    try {
      const credentials: Record<string, string> = {};
      const publicConfig: Record<string, unknown> = {};

      if (provider === "vapi") {
        if (apiKey.trim()) credentials.apiKey = apiKey.trim();
        if (phoneNumberId.trim()) publicConfig.phoneNumberId = phoneNumberId.trim();
        if (assistantId.trim()) publicConfig.assistantId = assistantId.trim();
      } else if (provider === "twilio") {
        if (accountSid.trim()) credentials.accountSid = accountSid.trim();
        if (authToken.trim()) credentials.authToken = authToken.trim();
        if (fromNumber.trim()) publicConfig.fromNumber = fromNumber.trim();
      }

      if (editing) {
        const patch: Record<string, unknown> = {
          label: label.trim(),
          mode,
          enabled,
          isDefault,
          publicConfig,
        };
        if (Object.keys(credentials).length > 0) patch.credentials = credentials;
        if (webhookSecret.trim()) patch.webhookSecret = webhookSecret.trim();

        const res = await fetch(`/api/integrations/voice/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error?.message || "Failed to update voice account");
        }
        toast.success("Voice account updated");
      } else {
        const body: Record<string, unknown> = {
          provider,
          label: label.trim(),
          mode: provider === "mock" ? "mock" : mode,
          enabled,
          isDefault,
          credentials,
          publicConfig,
        };
        if (webhookSecret.trim()) body.webhookSecret = webhookSecret.trim();

        const res = await fetch("/api/integrations/voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error?.message || "Failed to add voice account");
        }
        toast.success("Voice account added");
      }

      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card text-card-foreground border border-border rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border/60">
          <h2 className="text-lg font-semibold">
            {editing ? "Edit Voice Provider" : "Connect Voice Provider"}
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
          {!editing && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Provider</label>
              <select
                value={provider}
                onChange={(e) => {
                  const next = e.target.value as VoiceProvider;
                  setProvider(next);
                  setMode(next === "mock" ? "mock" : "live");
                }}
                className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="vapi">Vapi Voice AI (Recommended)</option>
                <option value="twilio">Twilio Voice (TwiML)</option>
                <option value="mock">Mock Voice Simulator (Testing)</option>
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Display Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={
                provider === "vapi"
                  ? "e.g., Vapi Sales Line"
                  : provider === "twilio"
                    ? "e.g., Twilio BD Support"
                    : "e.g., Mock Voice Tester"
              }
              className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm"
              required
            />
          </div>

          {provider === "vapi" && (
            <div className="space-y-3 p-3.5 rounded-xl bg-muted/40 border border-border/50">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Vapi Private API Key {editing && "(leave blank to keep current)"}
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk_vapi_..."
                  className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Vapi Phone Number ID</label>
                <input
                  type="text"
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  placeholder="UUID from Vapi Dashboard -> Phone Numbers"
                  className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Assistant ID (optional — uses inline AI Agent prompt if blank)
                </label>
                <input
                  type="text"
                  value={assistantId}
                  onChange={(e) => setAssistantId(e.target.value)}
                  placeholder="Optional Vapi Assistant UUID"
                  className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm font-mono"
                />
              </div>
            </div>
          )}

          {provider === "twilio" && (
            <div className="space-y-3 p-3.5 rounded-xl bg-muted/40 border border-border/50">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Twilio Account SID {editing && "(leave blank to keep current)"}
                </label>
                <input
                  type="text"
                  value={accountSid}
                  onChange={(e) => setAccountSid(e.target.value)}
                  placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Twilio Auth Token {editing && "(leave blank to keep current)"}
                </label>
                <input
                  type="password"
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder="Twilio Auth Token"
                  className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">From Phone Number (E.164)</label>
                <input
                  type="text"
                  value={fromNumber}
                  onChange={(e) => setFromNumber(e.target.value)}
                  placeholder="+15551234567"
                  className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm font-mono"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              Webhook Secret (optional{editing ? " — leave blank to keep current" : ""})
            </label>
            <input
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder="Shared secret for verifying inbound webhook calls"
              className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm font-mono"
            />
          </div>

          <div className="flex items-center gap-6 pt-1">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span>Enabled</span>
            </label>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span>Default Provider</span>
            </label>
          </div>

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
              {editing ? "Save Changes" : "Connect Provider"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function VoiceFormDialog({ open, onOpenChange, editing, onSuccess }: VoiceFormDialogProps) {
  if (!open) return null;
  return (
    <VoiceFormBody
      key={editing?.id ?? "new"}
      editing={editing}
      onClose={() => onOpenChange(false)}
      onSuccess={onSuccess}
    />
  );
}
