/**
 * Order pricing. Pure integer-paisa arithmetic: no floats, every intermediate checked with
 * `Number.isSafeInteger`. Failures are `ValidationError`s whose `path` names the field.
 */
import { ValidationError, type ValidationDetail } from "@/lib/errors";
import {
  MAX_LINE_QUANTITY,
  MAX_ORDER_LINES,
  type DeliveryZone,
  type OrderSettings,
} from "@/schemas/order";

export interface PricingResult {
  subtotalMinor: number;
  discountMinor: number;
  deliveryChargeMinor: number;
  totalMinor: number;
}

export function deliveryChargeFor(zone: DeliveryZone, settings: OrderSettings): number {
  return zone === "inside_dhaka"
    ? settings.deliveryChargeInsideDhakaMinor
    : settings.deliveryChargeOutsideDhakaMinor;
}

const isNonNegativeInt = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

export function priceOrder(input: {
  lines: Array<{ unitPriceMinor: number; quantity: number }>;
  discountMinor: number;
  zone: DeliveryZone;
  settings: OrderSettings;
}): PricingResult {
  const { lines, discountMinor, zone, settings } = input;
  const problems: ValidationDetail[] = [];

  if (lines.length < 1 || lines.length > MAX_ORDER_LINES) {
    problems.push({ path: "lines", message: `Use 1 to ${MAX_ORDER_LINES} items` });
  }
  lines.forEach((line, i) => {
    if (!isNonNegativeInt(line.unitPriceMinor)) {
      problems.push({
        path: `lines.${i}.unitPriceMinor`,
        message: "Enter a whole number of paisa (0 or more)",
      });
    }
    if (
      !isNonNegativeInt(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > MAX_LINE_QUANTITY
    ) {
      problems.push({
        path: `lines.${i}.quantity`,
        message: `Enter a quantity from 1 to ${MAX_LINE_QUANTITY}`,
      });
    }
  });
  if (!isNonNegativeInt(discountMinor)) {
    problems.push({
      path: "discountMinor",
      message: "Enter a whole number of paisa (0 or more)",
    });
  }
  if (problems.length > 0) throw new ValidationError(problems);

  let subtotalMinor = 0;
  for (const [i, line] of lines.entries()) {
    const lineTotal = line.unitPriceMinor * line.quantity;
    subtotalMinor += lineTotal;
    if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(subtotalMinor)) {
      throw new ValidationError([
        { path: `lines.${i}`, message: "The order total is too large" },
      ]);
    }
  }

  if (discountMinor > subtotalMinor) {
    throw new ValidationError([
      { path: "discountMinor", message: "The discount can't be more than the subtotal" },
    ]);
  }

  const deliveryChargeMinor = deliveryChargeFor(zone, settings);
  const totalMinor = subtotalMinor - discountMinor + deliveryChargeMinor;
  if (!Number.isSafeInteger(totalMinor)) {
    throw new ValidationError([{ path: "lines", message: "The order total is too large" }]);
  }
  return { subtotalMinor, discountMinor, deliveryChargeMinor, totalMinor };
}
