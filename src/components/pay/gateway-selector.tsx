"use client";

import { useState } from "react";
import { CheckCircle2, CreditCard, Loader2, ShieldCheck } from "lucide-react";
import type { PublicPaymentView } from "@/schemas/payment";

interface GatewaySelectorProps {
  token: string;
  gateways: PublicPaymentView["availableGateways"];
}

const PROVIDER_NAMES: Record<string, { title: string; subtitle: string }> = {
  sslcommerz: {
    title: "Cards, Mobile Banking & NetBanking",
    subtitle: "bKash, Nagad, Rocket, Visa, Mastercard via SSLCommerz",
  },
  aamarpay: {
    title: "aamarPay Gateway",
    subtitle: "bKash, Nagad, Rocket, Cards via aamarPay",
  },
  uddoktapay: {
    title: "UddoktaPay Gateway",
    subtitle: "bKash, Nagad, Rocket, Upay via UddoktaPay",
  },
  mock: {
    title: "Test / Simulator Gateway",
    subtitle: "Sandbox payment simulator for test runs",
  },
};

export function GatewaySelector({ token, gateways }: GatewaySelectorProps) {
  const defaultGateway = gateways.find((g) => g.isDefault) ?? gateways[0];
  const [selectedId, setSelectedId] = useState<string | null>(defaultGateway?.id ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (gateways.length === 0) {
    return (
      <div className="w-full max-w-md mx-auto p-4 rounded-xl bg-muted/50 border border-border text-center text-xs text-muted-foreground">
        No online payment methods are currently active. Please contact customer support.
      </div>
    );
  }

  const handlePay = async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/pay/${token}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gatewayAccountId: selectedId }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || "Failed to initiate payment session");
      }

      if (json.data?.redirectUrl) {
        window.location.href = json.data.redirectUrl;
      } else {
        throw new Error("No payment URL received");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
          Choose Payment Method
        </label>
        <div className="space-y-2.5">
          {gateways.map((gw) => {
            const isSelected = gw.id === selectedId;
            const meta = PROVIDER_NAMES[gw.provider] ?? {
              title: gw.label,
              subtitle: gw.provider,
            };

            return (
              <button
                key={gw.id}
                type="button"
                onClick={() => setSelectedId(gw.id)}
                disabled={loading}
                className={`w-full text-left p-4 rounded-xl border transition-all flex items-start justify-between cursor-pointer ${
                  isSelected
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border/60 bg-card hover:bg-muted/40 hover:border-border"
                } ${loading ? "opacity-60 pointer-events-none" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 p-2 rounded-lg ${
                      isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <CreditCard className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                      {gw.label || meta.title}
                      {gw.isDefault && (
                        <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          Default
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{meta.subtitle}</p>
                  </div>
                </div>
                {isSelected && <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive font-medium">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handlePay}
        disabled={!selectedId || loading}
        className="w-full py-3.5 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-md hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none transition-all flex items-center justify-center gap-2 cursor-pointer"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Connecting to Payment Gateway...
          </>
        ) : (
          <>
            <ShieldCheck className="w-4 h-4" />
            Proceed to Secure Payment
          </>
        )}
      </button>

      <p className="text-center text-[11px] text-muted-foreground flex items-center justify-center gap-1">
        <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground/80" />
        Secured by 256-bit encryption. Your payment details are safe.
      </p>
    </div>
  );
}
