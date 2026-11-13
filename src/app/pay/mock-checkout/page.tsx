"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CheckCircle2, FlaskConical, Loader2, XCircle } from "lucide-react";
import { formatMoneyMinor } from "@/lib/format";

function MockCheckoutContent() {
  const searchParams = useSearchParams();
  const tranId = searchParams.get("tranId") ?? "";
  const successUrl = searchParams.get("successUrl") ?? "";
  const failUrl = searchParams.get("failUrl") ?? "";
  const cancelUrl = searchParams.get("cancelUrl") ?? "";
  const amountStr = searchParams.get("amount");
  const amountMinor = amountStr ? parseInt(amountStr, 10) : 0;

  const [loading, setLoading] = useState<"success" | "failure" | "cancel" | null>(null);

  const simulate = async (outcome: "paid" | "failed", targetUrl: string) => {
    setLoading(outcome === "paid" ? "success" : "failure");
    try {
      await fetch("/api/pay/mock/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tranId, outcome }),
      });
      window.location.href = targetUrl;
    } catch {
      setLoading(null);
    }
  };

  const handleCancel = () => {
    setLoading("cancel");
    window.location.href = cancelUrl;
  };

  return (
    <div className="bg-card text-card-foreground rounded-2xl shadow-xl border border-border/40 p-6 sm:p-8 text-center space-y-6">
      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-xs font-semibold text-amber-600 dark:text-amber-400">
        <FlaskConical className="w-3.5 h-3.5" />
        <span>Sandbox Simulator</span>
      </div>

      <div className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Simulate Checkout</h1>
        <p className="text-xs text-muted-foreground">
          Choose an outcome to test order confirmation and webhook handling.
        </p>
      </div>

      <div className="p-4 rounded-xl bg-muted/40 border border-border/40 text-left space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Transaction ID:</span>
          <span className="font-mono text-foreground font-medium truncate max-w-[200px]">
            {tranId || "—"}
          </span>
        </div>
        {amountMinor > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Amount:</span>
            <span className="font-mono font-bold text-foreground">
              {formatMoneyMinor(amountMinor)}
            </span>
          </div>
        )}
      </div>

      <div className="space-y-3 pt-2">
        <button
          type="button"
          disabled={loading !== null || !successUrl}
          onClick={() => simulate("paid", successUrl)}
          className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
        >
          {loading === "success" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CheckCircle2 className="w-4 h-4" />
          )}
          Simulate Successful Payment
        </button>

        <button
          type="button"
          disabled={loading !== null || !failUrl}
          onClick={() => simulate("failed", failUrl)}
          className="w-full py-3 px-4 rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground font-semibold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
        >
          {loading === "failure" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <XCircle className="w-4 h-4" />
          )}
          Simulate Failed Payment
        </button>

        <button
          type="button"
          disabled={loading !== null || !cancelUrl}
          onClick={handleCancel}
          className="w-full py-2.5 px-4 rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground font-medium text-xs transition-all cursor-pointer disabled:opacity-50"
        >
          {loading === "cancel" ? "Cancelling..." : "Cancel Payment"}
        </button>
      </div>
    </div>
  );
}

export default function MockCheckoutPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/30 to-background flex flex-col justify-between p-4 sm:p-6 md:p-8">
      <header className="w-full max-w-md mx-auto py-4 text-center">
        <div className="inline-flex items-center gap-2 font-bold text-lg tracking-tight text-foreground">
          <FlaskConical className="w-6 h-6 text-primary" />
          <span>Payment Gateway Simulator</span>
        </div>
      </header>

      <main className="w-full max-w-md mx-auto my-auto">
        <Suspense
          fallback={
            <div className="p-8 text-center text-muted-foreground text-sm">
              Loading simulator...
            </div>
          }
        >
          <MockCheckoutContent />
        </Suspense>
      </main>

      <footer className="w-full max-w-md mx-auto py-6 text-center text-[11px] text-muted-foreground">
        <p>SalesPilot AI Test Environment</p>
      </footer>
    </div>
  );
}
