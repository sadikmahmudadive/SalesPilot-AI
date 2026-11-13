"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import type { IntegrationMode } from "@/schemas/integration";
import type { CourierAccountSummary, CourierProvider } from "@/schemas/courier";

interface CourierFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: CourierAccountSummary | null;
  onSuccess: () => void;
}

function CourierFormBody({
  editing,
  onClose,
  onSuccess,
}: {
  editing: CourierAccountSummary | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [provider, setProvider] = useState<CourierProvider>(editing?.provider ?? "steadfast");
  const [label, setLabel] = useState(editing?.label ?? "");
  const [mode, setMode] = useState<IntegrationMode>(editing?.mode ?? "sandbox");
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);
  const [isDefault, setIsDefault] = useState(editing?.isDefault ?? false);

  // Steadfast / RedX
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");

  // Pathao
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Webhook Secret
  const [webhookSecret, setWebhookSecret] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) {
      toast.error("Courier label is required");
      return;
    }

    setSubmitting(true);
    try {
      const credentials: Record<string, string> = {};

      if (provider === "steadfast") {
        if (apiKey) credentials.apiKey = apiKey.trim();
        if (secretKey) credentials.secretKey = secretKey.trim();
      } else if (provider === "pathao") {
        if (clientId) credentials.client_id = clientId.trim();
        if (clientSecret) credentials.client_secret = clientSecret.trim();
        if (username) credentials.username = username.trim();
        if (password) credentials.password = password.trim();
      } else if (provider === "redx") {
        if (apiKey) credentials.apiKey = apiKey.trim();
      }

      if (editing) {
        // PATCH
        const patch: Record<string, unknown> = {
          label: label.trim(),
          mode,
          enabled,
          isDefault,
        };

        if (Object.keys(credentials).length > 0) {
          patch.credentials = credentials;
        }
        if (webhookSecret.trim()) {
          patch.webhookSecret = webhookSecret.trim();
        }

        const res = await fetch(`/api/integrations/couriers/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error?.message || "Failed to update courier");
        }

        toast.success("Courier account updated");
      } else {
        // POST
        const body: Record<string, unknown> = {
          provider,
          label: label.trim(),
          mode,
          enabled,
          isDefault,
          credentials,
          publicConfig: {},
        };

        if (webhookSecret.trim()) {
          body.webhookSecret = webhookSecret.trim();
        }

        const res = await fetch("/api/integrations/couriers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error?.message || "Failed to create courier");
        }

        toast.success("Courier account added");
      }

      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save courier");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-card text-card-foreground rounded-2xl border border-border shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-border/50">
        <div>
          <h2 className="font-bold text-lg text-foreground">
            {editing ? "Edit Courier Partner" : "Connect Courier Partner"}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure delivery APIs and webhook credentials.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 text-muted-foreground hover:text-foreground rounded-xl hover:bg-muted transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        {/* Provider */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Courier Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as CourierProvider)}
            disabled={!!editing}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          >
            <option value="steadfast">Steadfast Courier</option>
            <option value="pathao">Pathao Courier</option>
            <option value="redx">RedX Logistics</option>
            <option value="mock">Mock Courier (Development & Testing)</option>
          </select>
        </div>

        {/* Label */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Display Label</label>
          <input
            type="text"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Steadfast Express, Pathao Primary"
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Mode */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">Environment Mode</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as IntegrationMode)}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="sandbox">Sandbox / Staging</option>
            <option value="live">Live / Production</option>
            <option value="mock">Mock Emulation</option>
          </select>
        </div>

        {/* Credentials Section */}
        <div className="pt-2 border-t border-border/40 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground">API Credentials</span>
            {editing?.hasCredentials && (
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                ✓ Credentials securely stored
              </span>
            )}
          </div>

          {provider === "steadfast" ? (
            <>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={editing?.hasCredentials ? "•••••••• (Leave blank to keep current)" : "Enter Steadfast API Key"}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Secret Key</label>
                <input
                  type="password"
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  placeholder={editing?.hasCredentials ? "•••••••• (Leave blank to keep current)" : "Enter Steadfast Secret Key"}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </>
          ) : provider === "pathao" ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Client ID</label>
                  <input
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="OAuth Client ID"
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Client Secret</label>
                  <input
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder="OAuth Secret"
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Username / Email</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Pathao Account Email"
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Pathao Password"
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm"
                  />
                </div>
              </div>
            </>
          ) : provider === "redx" ? (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">RedX API Token</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={editing?.hasCredentials ? "•••••••• (Leave blank to keep current)" : "Enter RedX API Token"}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              Mock courier requires no external API credentials.
            </p>
          )}

          {/* Inbound Webhook Secret */}
          <div className="space-y-1 pt-1">
            <label className="text-xs text-muted-foreground">Webhook Verification Secret (Optional)</label>
            <input
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder={editing?.hasWebhookSecret ? "•••••••• (Leave blank to keep current)" : "Shared secret for signature verification"}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        {/* Checkboxes */}
        <div className="pt-2 border-t border-border/40 space-y-2">
          <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-input text-primary focus:ring-ring"
            />
            Enable this courier integration for bookings
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="rounded border-input text-primary focus:ring-ring"
            />
            Make this the default courier partner for new orders
          </label>
        </div>

        {/* Actions */}
        <div className="pt-4 border-t border-border/50 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-xl border border-border/60 hover:bg-muted text-xs font-medium text-foreground transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {editing ? "Save Changes" : "Connect Courier"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function CourierFormDialog({
  open,
  onOpenChange,
  editing,
  onSuccess,
}: CourierFormDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <CourierFormBody
        key={editing?.id ?? "new"}
        editing={editing}
        onClose={() => onOpenChange(false)}
        onSuccess={onSuccess}
      />
    </div>
  );
}
