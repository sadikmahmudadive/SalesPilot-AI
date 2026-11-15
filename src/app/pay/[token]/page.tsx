import { notFound } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import { resolvePaymentLink } from "@/services/payments/links";
import { PayCard } from "@/components/pay/pay-card";
import { GatewaySelector } from "@/components/pay/gateway-selector";

interface PayPageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = "force-dynamic";

export default async function PayPage({ params }: PayPageProps) {
  const { token } = await params;

  let payment;
  try {
    payment = await resolvePaymentLink(token);
  } catch {
    notFound();
  }

  const isAwaiting = payment.status === "awaiting_payment";
  const isPaid = payment.status === "paid" || payment.status === "already_processed";

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

      <main className="w-full max-w-md mx-auto my-auto space-y-6">
        {isPaid ? (
          <div className="bg-card text-card-foreground rounded-2xl shadow-xl border border-emerald-500/30 p-8 text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Order Already Paid</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Order #{payment.orderNumber} has already been settled. Thank you!
              </p>
            </div>
            <PayCard payment={payment} />
          </div>
        ) : isAwaiting ? (
          <>
            <PayCard payment={payment} />
            <GatewaySelector token={token} gateways={payment.availableGateways} />
          </>
        ) : (
          <div className="bg-card text-card-foreground rounded-2xl shadow-xl border border-border/40 p-8 text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center">
              <AlertCircle className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">
                Payment Link {payment.status === "expired" ? "Expired" : "Unavailable"}
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                {payment.status === "expired"
                  ? "This checkout session has expired. Please contact the merchant for a new payment link."
                  : "This order cannot be paid online at this time."}
              </p>
            </div>
          </div>
        )}
      </main>

      <footer className="w-full max-w-md mx-auto py-6 text-center text-[11px] text-muted-foreground space-y-1">
        <p>Powered by SalesPilot AI Checkout</p>
      </footer>
    </div>
  );
}
