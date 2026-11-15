/**
 * `check_stock`: availability of one product (or one variant) the agent may see. Server-only.
 * Without a `variantId` a product with variants reports the SUM over its variants.
 */
import "server-only";

import { z } from "zod";

import {
  loadVisibleProduct,
  readAvailable,
  resolveUnit,
  stockStatusOf,
  stockUnitIds,
  unitKey,
} from "./catalog-access";
import { defineTool, toolFailure, type ToolContext, type ToolOutcome } from "./types";

const inputSchema = z.object({
  productId: z.string().min(1).max(200),
  variantId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Variant id, if the customer chose one."),
});
type StockInput = z.output<typeof inputSchema>;

const outputSchema = z.object({
  productId: z.string(),
  variantId: z.string().optional(),
  status: z.enum(["in_stock", "low", "out_of_stock"]),
  available: z.number().int(),
});
type StockOutput = z.output<typeof outputSchema>;

async function run(ctx: ToolContext, input: StockInput): Promise<ToolOutcome<StockOutput>> {
  const product = await loadVisibleProduct(ctx, input.productId);
  if (!product) return toolFailure("not_found");
  const unit = resolveUnit(product, input.variantId);
  if (unit.kind === "invalid") {
    return toolFailure("not_found", "That product variant isn't available.");
  }

  const variantIds = unit.kind === "unit" ? [unit.variantId] : stockUnitIds(product);
  const available = await readAvailable(
    ctx,
    variantIds.map((variantId) => ({ productId: product.id, variantId })),
  );
  const total = variantIds.reduce(
    (sum, variantId) => sum + (available.get(unitKey({ productId: product.id, variantId })) ?? 0),
    0,
  );
  const data: StockOutput = {
    productId: product.id,
    status: stockStatusOf(total),
    available: total,
  };
  if (unit.kind === "unit") data.variantId = unit.variantId;
  return { ok: true, data };
}

export const checkStockTool = defineTool<StockInput, StockOutput>({
  name: "check_stock",
  description:
    "Check whether a product (or one of its variants) is in stock. Returns in_stock, low or " +
    "out_of_stock and the available quantity. Without a variant, a product with variants " +
    "reports the total across its variants.",
  input: inputSchema,
  output: outputSchema,
  writes: false,
  run,
});
