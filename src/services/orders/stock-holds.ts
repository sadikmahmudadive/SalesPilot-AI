/**
 * Stock holds of order lines. Server-only.
 *
 * Every order line holds its stock through ONE reservation of `services/inventory/stock.ts`
 * (called unchanged), keyed `ord_{orderId}_r{revision}_l{lineIndex}`. The key is stable across
 * retries of a line and different for every line and every draft revision, so a replay never
 * double-reserves and an edit's new lines never collide with the lines they replace.
 *
 * Release and commit are idempotent per line, so the expiry sweep, staff actions and webhooks can
 * race safely:
 *   - releaseLines: a key that was never reserved (`NotFoundError`) counts as already free; a
 *     repeat release is a no-op; a committed key is a `ConflictError` that propagates.
 *   - commitLines: a repeat commit is a no-op; a released or unknown key propagates.
 * Lines are processed one at a time (two lines may share a stock unit, and parallel transactions
 * on one inventory document only contend). Every line is attempted even when an earlier one
 * fails; the first failure is then rethrown, so one bad line never strands the others.
 */
import "server-only";

import { NotFoundError, ValidationError, type ValidationDetail } from "@/lib/errors";
import type { OrderLine } from "@/schemas/order";
import { commitStock, releaseStock, type StockOptions } from "@/services/inventory/stock";

export type OrderLineProblem = "out_of_stock" | "unavailable" | "invalid_variant";

/** One or more order lines can't be ordered. `details`: `[{ path: "lines.{i}", message }]`. */
export class OrderLineError extends ValidationError {
  constructor(details: ReadonlyArray<{ path: string; message: OrderLineProblem }>) {
    super(details as ReadonlyArray<ValidationDetail>, "Some items can't be ordered");
    this.name = "OrderLineError";
  }
}

export function holdKey(orderId: string, revision: number, lineIndex: number): string {
  return `ord_${orderId}_r${revision}_l${lineIndex}`;
}

async function eachLine(
  lines: readonly OrderLine[],
  fn: (line: OrderLine) => Promise<void>,
): Promise<void> {
  let first: { error: unknown } | null = null;
  for (const line of lines) {
    try {
      await fn(line);
    } catch (error) {
      first ??= { error };
    }
  }
  if (first) throw first.error;
}

export async function releaseLines(
  orgId: string,
  lines: readonly OrderLine[],
  options?: StockOptions,
): Promise<void> {
  await eachLine(lines, async (line) => {
    try {
      await releaseStock(orgId, line.productId, line.variantId, line.holdKey, options);
    } catch (error) {
      if (error instanceof NotFoundError) return; // never reserved: already free
      throw error;
    }
  });
}

export async function commitLines(
  orgId: string,
  lines: readonly OrderLine[],
  options?: StockOptions,
): Promise<void> {
  await eachLine(lines, (line) =>
    commitStock(orgId, line.productId, line.variantId, line.holdKey, options),
  );
}
