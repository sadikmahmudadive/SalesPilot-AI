"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import type {
  GatewayAccountSummary,
  GatewayProvider,
  IntegrationMode,
} from "@/schemas/integration";

interface GatewayFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: GatewayAccountSummary | null;
  onSuccess: () => void;
}

function GatewayFormBody({
  editing,
  onClose,
  onSuccess,
}: {
  editing: GatewayAccountSummary | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [provider, setProvider] = useState<GatewayProvider>(editing?.provider ?? "sslcommerz");
  const [label, setLabel] = useState(editing?.label ?? "");
  const [mode, setMode] = useState<IntegrationMode>(editing?.mode ?? "sandbox");
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);
  const [isDefault, setIsDefault] = useState(editing?.isDefault ?? false);

  // Provider credentials (secrets never pre-filled for editing)
  const [storeId, setStoreId] = useState("");
  const [storePassword, setStorePassword] = useState("");
  const [signatureKey, setSignatureKey] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState((editing?.publicConfig?.baseUrl as string) || "");

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

      if (provider === "sslcommerz") {
        if (storeId) credentials.storeId = storeId.trim();
        if (storePassword) credentials.storePassword = storePassword.trim();
      } else if (provider === "aamarpay") {
        if (storeId) credentials.storeId = storeId.trim();
        if (signatureKey) credentials.signatureKey = signatureKey.trim();
      } else if (provider === "uddoktapay") {
        if (apiKey) credentials.apiKey = apiKey.trim();
        if (baseUrl) publicConfig.baseUrl = baseUrl.trim();
      }

      if (editing) {
        // PATCH
        const patch: Record<string, unknown> = {
          label: label.trim(),
          mode,
          enabled,
          isDefault,
          publicConfig,
        };
        if (Object.keys(credentials).length > 0) {
          patch.credentials = credentials;
        }

        const res = await fetch(`/api/integrations/gateways/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error?.message || "Failed to update gateway");
        }

        toast.success("Gateway account updated");
      } else {
        // POST
        const body = {
          provider,
          label: label.trim(),
          mode,
          enabled,
          isDefault,
          credentials,
          publicConfig,
        };

        const res = await fetch("/api/integrations/gateways", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error?.message || "Failed to create gateway");
        }

        toast.success("Gateway account added");
      }

      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save gateway");
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
            {editing ? "Edit Payment Gateway" : "Add Payment Gateway"}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure credentials and options for online checkout.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
            Provider
          </label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as GatewayProvider)}
            disabled={!!editing || submitting}
            className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm text-foreground focus:ring-1 focus:ring-primary outline-none disabled:opacity-50"
          >
            <option value="sslcommerz">SSLCommerz (Cards & MFS)</option>
            <option value="aamarpay">aamarPay</option>
            <option value="uddoktapay">UddoktaPay</option>
            <option value="mock">Mock Simulator (Testing)</option>
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
            Account Label
          </label>
          <input
            type="text"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Primary SSLCommerz, Live Store Gateway"
            className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm text-foreground focus:ring-1 focus:ring-primary outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
              Mode
            </label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as IntegrationMode)}
              className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm text-foreground focus:ring-1 focus:ring-primary outline-none"
            >
              <option value="sandbox">Sandbox / Test</option>
              <option value="live">Live / Production</option>
              <option value="mock">Mock</option>
            </select>
          </div>

          <div className="flex flex-col justify-end gap-2 pb-1">
            <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary"
              />
              Default Gateway
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary"
              />
              Active (Enabled)
            </label>
          </div>
        </div>

        {/* Provider Specific Inputs */}
        {provider === "sslcommerz" && (
          <div className="space-y-3 pt-3 border-t border-border/40">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              SSLCommerz Credentials {editing && "(Leave blank to keep current)"}
            </h3>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Store ID</label>
              <input
                type="text"
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                placeholder="e.g. testbox"
                className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm text-foreground focus:ring-1 focus:ring-primary outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Store Password</label>
              <input
                type="password"
                value={storePassword}
                onChange={(e) => setStorePassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm text-foreground focus:ring-1 focus:ring-primary outline-none font-mono"
              />
            </div>
          </div>
        )}

        {provider === "aamarpay" && (
          <div className="space-y-3 pt-3 border-t border-border/40">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              aamarPay Credentials {editing && "(Leave blank to keep current)"}
            </h3>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Store ID / Merchant ID</label>
              <input
                type="text"
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                placeholder="e.g. aamarpaytest"
                className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm text-foreground focus:ring-1 focus:ring-primary outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Signature Key</label>
              <input
                type="password"
                value={signatureKey}
                onChange={(e) => setSignatureKey(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm text-foreground focus:ring-1 focus:ring-primary outline-none font-mono"
              />
            </div>
          </div>
        )}

        {provider === "uddoktapay" && (
          <div className="space-y-3 pt-3 border-t border-border/40">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              UddoktaPay Credentials {editing && "(Leave blank to keep current)"}
            </h3>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm text-foreground focus:ring-1 focus:ring-primary outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Custom API Base URL (optional)</label>
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://pay.uddoktapay.com/api/checkout-v2"
                className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm text-foreground focus:ring-1 focus:ring-primary outline-none font-mono"
              />
            </div>
          </div>
        )}

        {provider === "mock" && (
          <div className="p-3 rounded-xl bg-muted/40 border border-border/40 text-xs text-muted-foreground">
            Mock Gateway requires no external credentials. It simulates successful and failed transactions directly inside the browser.
          </div>
        )}

        <div className="pt-4 border-t border-border/50 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="py-2.5 px-4 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="py-2.5 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold shadow hover:bg-primary/90 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {editing ? "Save Changes" : "Create Gateway"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function GatewayFormDialog({
  open,
  onOpenChange,
  editing,
  onSuccess,
}: GatewayFormDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in-0">
      <GatewayFormBody
        key={editing?.id ?? "new"}
        editing={editing}
        onClose={() => onOpenChange(false)}
        onSuccess={onSuccess}
      />
    </div>
  );
}
