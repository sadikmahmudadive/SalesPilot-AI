import { formatMoneyMinor } from "@/lib/format";

interface PriceDisplayProps {
  regularMinor: number;
  saleMinor?: number;
}

/** The price to pay, with the regular price struck through when there is a lower sale price. */
export function PriceDisplay({ regularMinor, saleMinor }: PriceDisplayProps) {
  if (saleMinor === undefined || saleMinor >= regularMinor) {
    return <span className="tabular-nums">{formatMoneyMinor(regularMinor)}</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-baseline justify-end gap-x-1.5 tabular-nums">
      <span className="font-medium">
        <span className="sr-only">Sale price </span>
        {formatMoneyMinor(saleMinor)}
      </span>
      <s className="text-xs text-muted-foreground">
        <span className="sr-only">Regular price </span>
        {formatMoneyMinor(regularMinor)}
      </s>
    </span>
  );
}
