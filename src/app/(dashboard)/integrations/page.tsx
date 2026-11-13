"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Copy,
  CreditCard,
  Loader2,
  Phone,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Truck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import type { GatewayAccountSummary } from "@/schemas/integration";
import type { CourierAccountSummary } from "@/schemas/courier";
import type { VoiceAccountSummary } from "@/schemas/voice";
import { GatewayCard } from "@/components/integrations/gateway-card";
import { GatewayFormDialog } from "@/components/integrations/gateway-form-dialog";
import { CourierCard } from "@/components/integrations/courier-card";
import { CourierFormDialog } from "@/components/integrations/courier-form-dialog";
import { VoiceCard } from "@/components/integrations/voice-card";
import { VoiceFormDialog } from "@/components/integrations/voice-form-dialog";

interface PlatformStatus {
  whatsapp: boolean;
  openai: boolean;
  cloudinary: boolean;
  n8n: boolean;
}

export default function IntegrationsPage() {
  const [activeTab, setActiveTab] = useState<"gateways" | "couriers" | "voice" | "platform">(
    "gateways",
  );
  const [gateways, setGateways] = useState<GatewayAccountSummary[]>([]);
  const [couriers, setCouriers] = useState<CourierAccountSummary[]>([]);
  const [voiceAccounts, setVoiceAccounts] = useState<VoiceAccountSummary[]>([]);
  const [platformStatus, setPlatformStatus] = useState<PlatformStatus | null>(null);
  const [loadingGateways, setLoadingGateways] = useState(true);
  const [loadingCouriers, setLoadingCouriers] = useState(true);
  const [loadingVoice, setLoadingVoice] = useState(true);
  const [loadingPlatform, setLoadingPlatform] = useState(true);

  // Gateway Dialog
  const [gatewayDialogOpen, setGatewayDialogOpen] = useState(false);
  const [editingGateway, setEditingGateway] = useState<GatewayAccountSummary | null>(null);

  // Courier Dialog
  const [courierDialogOpen, setCourierDialogOpen] = useState(false);
  const [editingCourier, setEditingCourier] = useState<CourierAccountSummary | null>(null);

  // Voice Dialog
  const [voiceDialogOpen, setVoiceDialogOpen] = useState(false);
  const [editingVoice, setEditingVoice] = useState<VoiceAccountSummary | null>(null);

  const refreshGateways = async () => {
    try {
      setLoadingGateways(true);
      const res = await fetch("/api/integrations/gateways");
      if (!res.ok) throw new Error("Failed to load payment gateways");
      const json = await res.json();
      setGateways(json.items ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load gateways");
    } finally {
      setLoadingGateways(false);
    }
  };

  const refreshCouriers = async () => {
    try {
      setLoadingCouriers(true);
      const res = await fetch("/api/integrations/couriers");
      if (!res.ok) throw new Error("Failed to load couriers");
      const json = await res.json();
      setCouriers(json.items ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load couriers");
    } finally {
      setLoadingCouriers(false);
    }
  };

  const refreshVoice = async () => {
    try {
      setLoadingVoice(true);
      const res = await fetch("/api/integrations/voice");
      if (!res.ok) throw new Error("Failed to load voice providers");
      const json = await res.json();
      setVoiceAccounts(json.items ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load voice providers");
    } finally {
      setLoadingVoice(false);
    }
  };

  const refreshPlatform = async () => {
    try {
      setLoadingPlatform(true);
      const res = await fetch("/api/integrations/status");
      if (!res.ok) throw new Error("Failed to load platform status");
      const json = (await res.json()) as { status?: PlatformStatus };
      if (json.status) setPlatformStatus(json.status);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load platform status");
    } finally {
      setLoadingPlatform(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [gwRes, crRes, vcRes, stRes] = await Promise.all([
          fetch("/api/integrations/gateways"),
          fetch("/api/integrations/couriers"),
          fetch("/api/integrations/voice"),
          fetch("/api/integrations/status"),
        ]);

        if (gwRes.ok) {
          const gwJson = await gwRes.json();
          if (!cancelled) setGateways(gwJson.items ?? []);
        }
        if (crRes.ok) {
          const crJson = await crRes.json();
          if (!cancelled) setCouriers(crJson.items ?? []);
        }
        if (vcRes.ok) {
          const vcJson = await vcRes.json();
          if (!cancelled) setVoiceAccounts(vcJson.items ?? []);
        }
        if (stRes.ok) {
          const stJson = (await stRes.json()) as { status?: PlatformStatus };
          if (!cancelled && stJson.status) setPlatformStatus(stJson.status);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load integrations");
        }
      } finally {
        if (!cancelled) {
          setLoadingGateways(false);
          setLoadingCouriers(false);
          setLoadingVoice(false);
          setLoadingPlatform(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenAdd = () => {
    if (activeTab === "gateways") {
      setEditingGateway(null);
      setGatewayDialogOpen(true);
    } else if (activeTab === "couriers") {
      setEditingCourier(null);
      setCourierDialogOpen(true);
    } else {
      setEditingVoice(null);
      setVoiceDialogOpen(true);
    }
  };

  const handleOpenEditGateway = (gw: GatewayAccountSummary) => {
    setEditingGateway(gw);
    setGatewayDialogOpen(true);
  };

  const handleOpenEditCourier = (cr: CourierAccountSummary) => {
    setEditingCourier(cr);
    setCourierDialogOpen(true);
  };

  const handleOpenEditVoice = (vc: VoiceAccountSummary) => {
    setEditingVoice(vc);
    setVoiceDialogOpen(true);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Integrations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connect online payment processors and courier logistics channels.
          </p>
        </div>

        {activeTab !== "platform" ? (
          <button
            type="button"
            onClick={handleOpenAdd}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow hover:bg-primary/90 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            {activeTab === "gateways"
              ? "Add Payment Gateway"
              : activeTab === "couriers"
                ? "Add Courier Partner"
                : "Connect Voice Provider"}
          </button>
        ) : null}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-1">
        <button
          type="button"
          onClick={() => setActiveTab("gateways")}
          className={`px-4 py-2 text-sm font-semibold rounded-t-xl transition-all flex items-center gap-2 cursor-pointer border-b-2 -mb-1 ${
            activeTab === "gateways"
              ? "border-primary text-primary bg-primary/5"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <CreditCard className="w-4 h-4" />
          Payment Gateways ({gateways.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("couriers")}
          className={`px-4 py-2 text-sm font-semibold rounded-t-xl transition-all flex items-center gap-2 cursor-pointer border-b-2 -mb-1 ${
            activeTab === "couriers"
              ? "border-primary text-primary bg-primary/5"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Truck className="w-4 h-4" />
          Couriers & Delivery ({couriers.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("voice")}
          className={`px-4 py-2 text-sm font-semibold rounded-t-xl transition-all flex items-center gap-2 cursor-pointer border-b-2 -mb-1 ${
            activeTab === "voice"
              ? "border-primary text-primary bg-primary/5"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Phone className="w-4 h-4" />
          Voice & Telephony ({voiceAccounts.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("platform")}
          className={`px-4 py-2 text-sm font-semibold rounded-t-xl transition-all flex items-center gap-2 cursor-pointer border-b-2 -mb-1 ${
            activeTab === "platform"
              ? "border-primary text-primary bg-primary/5"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Server className="w-4 h-4" />
          Platform & Webhooks
        </button>
      </div>

      {/* Content */}
      {activeTab === "gateways" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Configured payment processors for online customer checkout.</span>
            <button
              type="button"
              onClick={refreshGateways}
              disabled={loadingGateways}
              className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingGateways ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {loadingGateways ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-border/60 bg-muted/20">
              <Loader2 className="w-8 h-8 mx-auto animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground mt-2">Loading gateways...</p>
            </div>
          ) : gateways.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-border/60 bg-muted/20 space-y-4">
              <div className="w-12 h-12 mx-auto rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <CreditCard className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-foreground">
                  No Payment Gateways Configured
                </h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Add SSLCommerz, aamarPay, UddoktaPay or the test simulator to accept online card & mobile banking payments.
                </p>
              </div>
              <button
                type="button"
                onClick={handleOpenAdd}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold text-xs shadow hover:bg-primary/90 transition-all cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Configure Your First Gateway
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {gateways.map((gw) => (
                <GatewayCard
                  key={gw.id}
                  gateway={gw}
                  onEdit={handleOpenEditGateway}
                  onRefresh={refreshGateways}
                />
              ))}
            </div>
          )}
        </div>
      ) : activeTab === "couriers" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Integrated logistics partners for courier booking and parcel tracking.</span>
            <button
              type="button"
              onClick={refreshCouriers}
              disabled={loadingCouriers}
              className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingCouriers ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {loadingCouriers ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-border/60 bg-muted/20">
              <Loader2 className="w-8 h-8 mx-auto animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground mt-2">Loading couriers...</p>
            </div>
          ) : couriers.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-border/60 bg-muted/20 space-y-4">
              <div className="w-12 h-12 mx-auto rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Truck className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-foreground">
                  No Courier Partners Connected
                </h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Connect Steadfast, Pathao, RedX or the mock courier to automatically book parcels and track shipment delivery status.
                </p>
              </div>
              <button
                type="button"
                onClick={handleOpenAdd}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold text-xs shadow hover:bg-primary/90 transition-all cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Connect Your First Courier
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {couriers.map((cr) => (
                <CourierCard
                  key={cr.id}
                  courier={cr}
                  onEdit={handleOpenEditCourier}
                  onRefresh={refreshCouriers}
                />
              ))}
            </div>
          )}
        </div>
      ) : activeTab === "voice" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>AI voice & telephony providers for outbound and inbound customer calls.</span>
            <button
              type="button"
              onClick={refreshVoice}
              disabled={loadingVoice}
              className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingVoice ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {loadingVoice ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-border/60 bg-muted/20">
              <Loader2 className="w-8 h-8 mx-auto animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground mt-2">Loading voice providers...</p>
            </div>
          ) : voiceAccounts.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-border/60 bg-muted/20 space-y-4">
              <div className="w-12 h-12 mx-auto rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Phone className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-foreground">
                  No Voice Providers Connected
                </h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Connect Vapi Voice AI, Twilio Voice, or the Mock Voice simulator to run AI sales and order-confirmation calls.
                </p>
              </div>
              <button
                type="button"
                onClick={handleOpenAdd}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold text-xs shadow hover:bg-primary/90 transition-all cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Connect Your First Voice Provider
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {voiceAccounts.map((vc) => (
                <VoiceCard
                  key={vc.id}
                  account={vc}
                  onEdit={handleOpenEditVoice}
                  onRefresh={refreshVoice}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Server-side platform channel configuration and webhook endpoints for this deployment.
            </span>
            <button
              type="button"
              onClick={refreshPlatform}
              disabled={loadingPlatform}
              className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingPlatform ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {loadingPlatform && !platformStatus ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-border/60 bg-muted/20">
              <Loader2 className="w-8 h-8 mx-auto animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground mt-2">Checking platform channels...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                {
                  name: "WhatsApp Cloud API",
                  ready: platformStatus?.whatsapp ?? false,
                  description:
                    "Enables live customer WhatsApp messaging, AI inbox auto-replies, and automation outreach.",
                  guide: "See docs/setup/whatsapp.md to set environment credentials.",
                },
                {
                  name: "OpenAI AI Engine",
                  ready: platformStatus?.openai ?? false,
                  description:
                    "Powers autonomous sales agents, catalog lookup, and WhatsApp order drafting.",
                  guide: "See docs/setup/openai.md to configure your model key.",
                },
                {
                  name: "Cloudinary Media Storage",
                  ready: platformStatus?.cloudinary ?? false,
                  description:
                    "Stores signed product images, customer media, and organization assets.",
                  guide: "See docs/setup/cloudinary.md to configure upload signing.",
                },
                {
                  name: "n8n Webhook Bridge",
                  ready: platformStatus?.n8n ?? false,
                  description:
                    "Global default webhook configuration for external workflow orchestration.",
                  guide: "See docs/setup/n8n-automations.md (per-rule URLs work independently).",
                },
              ].map((channel) => (
                <div
                  key={channel.name}
                  className="rounded-2xl border border-border/60 bg-card p-5 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{channel.name}</h3>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        channel.ready
                          ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-amber-500/10 text-amber-600"
                      }`}
                    >
                      {channel.ready ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" /> Configured
                        </>
                      ) : (
                        <>
                          <XCircle className="w-3.5 h-3.5" /> Not configured
                        </>
                      )}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{channel.description}</p>
                  <p className="text-[11px] text-muted-foreground/80">{channel.guide}</p>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Core Platform Endpoints</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {[
                { label: "WhatsApp Cloud Webhook", path: "/api/webhooks/whatsapp" },
                { label: "Scheduled Sweep (Orders & Automations)", path: "/api/cron/orders/expire" },
              ].map((ep) => (
                <div
                  key={ep.path}
                  className="flex items-center justify-between gap-2 rounded-xl border bg-muted/20 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{ep.label}</p>
                    <p className="font-mono text-[11px] text-muted-foreground truncate">{ep.path}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const fullUrl =
                        typeof window !== "undefined" ? `${window.location.origin}${ep.path}` : ep.path;
                      void navigator.clipboard.writeText(fullUrl);
                      toast.success("Endpoint URL copied");
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium hover:bg-muted cursor-pointer shrink-0"
                  >
                    <Copy className="w-3 h-3" />
                    Copy
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Security Notice */}
      <div className="mt-8 p-4 rounded-xl bg-muted/30 border border-border/40 flex items-start gap-3 text-xs text-muted-foreground">
        <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-foreground">Bank-Grade Credential Encryption</p>
          <p className="mt-0.5">
            All API keys, store passwords and signature tokens are encrypted at rest with AES-256-GCM. Plaintext credentials are never stored or exposed in client responses.
          </p>
        </div>
      </div>

      {/* Gateway Dialog */}
      <GatewayFormDialog
        open={gatewayDialogOpen}
        onOpenChange={setGatewayDialogOpen}
        editing={editingGateway}
        onSuccess={refreshGateways}
      />

      {/* Courier Dialog */}
      <CourierFormDialog
        open={courierDialogOpen}
        onOpenChange={setCourierDialogOpen}
        editing={editingCourier}
        onSuccess={refreshCouriers}
      />

      {/* Voice Dialog */}
      <VoiceFormDialog
        open={voiceDialogOpen}
        onOpenChange={setVoiceDialogOpen}
        editing={editingVoice}
        onSuccess={refreshVoice}
      />
    </div>
  );
}
