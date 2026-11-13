"use client";

import { useEffect, useState } from "react";
import { CreditCard, Loader2, Plus, RefreshCw, ShieldCheck, Truck } from "lucide-react";
import { toast } from "sonner";

import type { GatewayAccountSummary } from "@/schemas/integration";
import type { CourierAccountSummary } from "@/schemas/courier";
import { GatewayCard } from "@/components/integrations/gateway-card";
import { GatewayFormDialog } from "@/components/integrations/gateway-form-dialog";
import { CourierCard } from "@/components/integrations/courier-card";
import { CourierFormDialog } from "@/components/integrations/courier-form-dialog";

export default function IntegrationsPage() {
  const [activeTab, setActiveTab] = useState<"gateways" | "couriers">("gateways");
  const [gateways, setGateways] = useState<GatewayAccountSummary[]>([]);
  const [couriers, setCouriers] = useState<CourierAccountSummary[]>([]);
  const [loadingGateways, setLoadingGateways] = useState(true);
  const [loadingCouriers, setLoadingCouriers] = useState(true);

  // Gateway Dialog
  const [gatewayDialogOpen, setGatewayDialogOpen] = useState(false);
  const [editingGateway, setEditingGateway] = useState<GatewayAccountSummary | null>(null);

  // Courier Dialog
  const [courierDialogOpen, setCourierDialogOpen] = useState(false);
  const [editingCourier, setEditingCourier] = useState<CourierAccountSummary | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [gwRes, crRes] = await Promise.all([
          fetch("/api/integrations/gateways"),
          fetch("/api/integrations/couriers"),
        ]);

        if (gwRes.ok) {
          const gwJson = await gwRes.json();
          if (!cancelled) setGateways(gwJson.items ?? []);
        }
        if (crRes.ok) {
          const crJson = await crRes.json();
          if (!cancelled) setCouriers(crJson.items ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load integrations");
        }
      } finally {
        if (!cancelled) {
          setLoadingGateways(false);
          setLoadingCouriers(false);
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
    } else {
      setEditingCourier(null);
      setCourierDialogOpen(true);
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

        <button
          type="button"
          onClick={handleOpenAdd}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow hover:bg-primary/90 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          {activeTab === "gateways" ? "Add Payment Gateway" : "Add Courier Partner"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border/60 pb-1">
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
      ) : (
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
    </div>
  );
}
