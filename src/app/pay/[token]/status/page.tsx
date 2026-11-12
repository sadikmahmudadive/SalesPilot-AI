import Link from "next/link";
import { AlertCircle, CheckCircle2, RotateCcw, XCircle } from "lucide-react";

import { getPaymentAttempt } from "@/repositories/payments";
import { resolvePaymentLink } from "@/services/payments/links";
import { formatMoneyMinor } from "@/lib/format";

interface StatusPageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ tranId?: string; status?: string }>;
}

export const dynamic = "force-dynamic";

export default async function PaymentStatusPage({ params, searchParams }: StatusPageProps) {
  const { token } = await params;
  const { tranId, status } = await searchParams;

  const attempt = tranId ? await getPaymentAttempt(tranId) : null;
  let payment = null;
  try {
    payment = await resolvePaymentLink(token);
  } catch {
    // Optional fallback
  }

  const isSuccess = status === "success" || attempt?.state === "paid" || payment?.status === "paid";
  const isCancelled = status === "cancel";
  const isFailed = status === "fail" || status === "failed" || attempt?.state === "failed";

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/30 to-background flex flex-col justify-between p-4 sm:p-6 md:p-8">
      <header className="w-full max-w-md mx-auto py-4 text-center">
        <div className="inline-flex items-center gap-2 font-bold text-lg tracking-tight text-foreground">
          <span className="w-7 h-7 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-black text-sm">
            SP
          </span>
          <span>SalesPilot Pay</span>
        </div>
      </header>

      <main className="w-full max-w-md mx-auto my-auto">
        <div className="bg-card text-card-foreground rounded-2xl shadow-xl border border-border/40 p-8 text-center space-y-6">
          {isSuccess ? (
            <>
              <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <div className="space-y-1">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Payment Successful!</h1>
                <p className="text-sm text-muted-foreground">
                  Thank you! Your payment has been received and verified.
                </p>
              </div>

              {attempt && (
                <div className="p-4 rounded-xl bg-muted/40 border border-border/40 text-left space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount Paid:</span>
                    <span className="font-mono font-bold text-foreground">
                      {formatMoneyMinor(attempt.expectedAmountMinor)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Transaction ID:</span>
                    <span className="font-mono text-muted-foreground truncate max-w-[180px]">
                      {attempt.tranId}
                    </span>
                  </div>
                  {payment && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Order:</span>
                      <span className="font-mono font-semibold text-foreground">
                        #{payment.orderNumber}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                We are now preparing your order for shipment. You will receive updates via SMS/WhatsApp.
              </p>
            </>
          ) : isCancelled ? (
            <>
              <div className="w-16 h-16 mx-auto rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center">
                <AlertCircle className="w-10 h-10" />
              </div>
              <div className="space-y-1">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Payment Cancelled</h1>
                <p className="text-sm text-muted-foreground">
                  You cancelled the payment process. No money was charged.
                </p>
              </div>

              <Link
                href={`/pay/${token}`}
                className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-md hover:bg-primary/90 transition-all flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Try Paying Again
              </Link>
            </>
          ) : isFailed ? (
            <>
              <div className="w-16 h-16 mx-auto rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
                <XCircle className="w-10 h-10" />
              </div>
              <div className="space-y-1">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Payment Failed</h1>
                <p className="text-sm text-muted-foreground">
                  Your transaction could not be processed by the payment provider.
                </p>
              </div>

              <Link
                href={`/pay/${token}`}
                className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-md hover:bg-primary/90 transition-all flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Try Another Payment Method
              </Link>
            </>
          ) : (
            <>
              <div className="w-16 h-16 mx-auto rounded-full bg-muted text-muted-foreground flex items-center justify-center">
                <AlertCircle className="w-10 h-10" />
              </div>
              <div className="space-y-1">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Payment Status</h1>
                <p className="text-sm text-muted-foreground">
                  Processing transaction confirmation...
                </p>
              </div>

              <Link
                href={`/pay/${token}`}
                className="inline-block text-xs text-primary underline"
              >
                Return to Checkout
              </Link>
            </>
          )}
        </div>
      </main>

      <footer className="w-full max-w-md mx-auto py-6 text-center text-[11px] text-muted-foreground">
        <p>SalesPilot AI Secure Payments</p>
      </footer>
    </div>
  );
}
