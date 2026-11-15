/**
 * `get_price`: retail or wholesale price of one product the agent may see. Server-only.
 *
 * Retail: `priceMinor` is the regular price, `salePriceMinor` the sale price when there is one,
 * `effectiveMinor` what the customer pays (sale else regular). Wholesale: the wholesale price is
 * both `priceMinor` and `effectiveMinor`; with no wholesale price the retail figures are returned
 * and `wholesaleFallback: true` says so. Prices are per product (variants do not change them);
 * a given `variantId` is only validated.
 */
import "server-only";

import { z } from "zod";

import { formatMoneyMinor } from "@/lib/format";

import { loadVisibleProduct, resolveUnit, unitPriceFor } from "./catalog-access";
import { defineTool, toolFailure, type ToolContext, type ToolOutcome } from "./types";

const inputSchema = z.object({
  productId: z.string().min(1).max(200),
  variantId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Variant id, if the customer chose one."),
  customerType: z.enum(["retail", "wholesale"]),
});
type PriceInput = z.output<typeof inputSchema>;

const outputSchema = z.object({
  productId: z.string(),
  customerType: z.enum(["retail", "wholesale"]),
  priceMinor: z.number().int(),
  salePriceMinor: z.number().int().optional(),
  effectiveMinor: z.number().int(),
  priceText: z.string(),
  wholesaleFallback: z.boolean().optional(),
});
type PriceOutput = z.output<typeof outputSchema>;

async function run(ctx: ToolContext, input: PriceInput): Promise<ToolOutcome<PriceOutput>> {
  const product = await loadVisibleProduct(ctx, input.productId);
  if (!product) return toolFailure("not_found");
  if (resolveUnit(product, input.variantId).kind === "invalid") {
    return toolFailure("not_found", "That product variant isn't available.");
  }

  const { unitMinor, wholesaleFallback } = unitPriceFor(product, input.customerType);
  const wholesale = input.customerType === "wholesale" && !wholesaleFallback;
  const data: PriceOutput = {
    productId: product.id,
    customerType: input.customerType,
    priceMinor: wholesale ? unitMinor : product.regularPriceMinor,
    effectiveMinor: unitMinor,
    priceText: formatMoneyMinor(unitMinor),
  };
  if (!wholesale && product.salePriceMinor !== undefined) {
    data.salePriceMinor = product.salePriceMinor;
  }
  if (wholesaleFallback) data.wholesaleFallback = true;
  return { ok: true, data };
}

export const getPriceTool = defineTool<PriceInput, PriceOutput>({
  name: "get_price",
  description:
    "Get the price of one product for a retail or wholesale customer. Returns the amount in " +
    "paisa and as taka text. Wholesale falls back to the retail price when the product has no " +
    "wholesale price, and the result says so.",
  input: inputSchema,
  output: outputSchema,
  writes: false,
  run,
});
