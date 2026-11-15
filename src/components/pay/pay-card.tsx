import type { PublicPaymentView } from "@/schemas/payment";
import { formatMoneyMinor } from "@/lib/format";

interface PayCardProps {
  payment: PublicPaymentView;
}

export function PayCard({ payment }: PayCardProps) {
  const isAwaiting = payment.status === "awaiting_payment";

  return (
    <div className="w-full max-w-md mx-auto bg-card text-card-foreground rounded-2xl shadow-xl border border-border/40 overflow-hidden">
      {/* Header */}
      <div className="bg-primary/5 p-6 border-b border-border/40 text-center">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          Payment for
        </p>
        <h1 className="text-xl font-bold tracking-tight mt-1">{payment.organizationName}</h1>
        <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-background border border-border text-xs font-mono font-medium text-muted-foreground">
          <span>Order #{payment.orderNumber}</span>
        </div>
      </div>

      {/* Line Items */}
      <div className="p-6 space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Order Summary
        </h2>
        <div className="divide-y divide-border/30">
          {payment.lines.map((line, idx) => (
            <div key={idx} className="py-2.5 flex items-center justify-between text-sm">
              <div className="pr-4">
                <p className="font-medium text-foreground">{line.name}</p>
                {line.variantName && (
                  <p className="text-xs text-muted-foreground">{line.variantName}</p>
                )}
                <p className="text-xs text-muted-foreground">Qty: {line.quantity}</p>
              </div>
              <span className="font-mono font-medium tabular-nums text-foreground">
                {formatMoneyMinor(line.totalMinor)}
              </span>
            </div>
          ))}
        </div>

        {/* Totals Breakdown */}
        <div className="pt-3 border-t border-border/40 space-y-1.5 text-sm">
          <div className="flex justify-between text-muted-foreground text-xs">
            <span>Delivery charge</span>
            <span className="font-mono">{formatMoneyMinor(payment.deliveryChargeMinor)}</span>
          </div>
          {payment.discountMinor > 0 && (
            <div className="flex justify-between text-emerald-600 dark:text-emerald-400 text-xs font-medium">
              <span>Discount</span>
              <span className="font-mono">-{formatMoneyMinor(payment.discountMinor)}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline pt-2 border-t border-border/40">
            <span className="font-semibold text-base text-foreground">Total Amount</span>
            <span className="font-mono font-bold text-xl text-primary">
              {formatMoneyMinor(payment.totalMinor)}
            </span>
          </div>
        </div>

        {/* Expiry / Status Alert */}
        {!isAwaiting && (
          <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center text-xs text-amber-600 dark:text-amber-400 font-medium">
            This payment link is no longer active ({payment.status.replace("_", " ")}).
          </div>
        )}
      </div>
    </div>
  );
}
