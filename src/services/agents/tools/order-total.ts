/**
 * `calculate_order_total`: prices up to 20 order lines for the model, so it never does the maths.
 * Server-only.
 *
 * MONEY. Integer paisa only: `lineMinor = unitMinor * quantity` (at most 1e9 * 1000, and at most
 * 20 lines, far below Number.MAX_SAFE_INTEGER); taka text comes from `formatMoneyMinor`. Unit
 * price is the sale price when present, else the regular price (retail), or the wholesale price
 * with a retail fallback flagged per line (`wholesaleFallback`).
 *
 * FLAGS. A line that cannot be sold is flagged and EXCLUDED from the subtotal (`excludedLines`
 * counts them), and carries no price:
 *   out_of_scope        missing, other organization, or outside the agent's categories
 *   archived            in scope but draft or archived
 *   invalid_variant     the product has variants and none (or an unknown one) was given, or a
 *                       variant was given for a product without variants
 *   insufficient_stock  the quantity exceeds what is available; repeated lines of the same unit
 *                       draw on the same stock in order, so splitting a line cannot bypass it
 * `out_of_scope` and `archived` lines carry no product data (no name); the other flags only occur
 * for active, in-scope products.
 */
import "server-only";

import { z } from "zod";

import { formatMoneyMinor } from "@/lib/format";
import { MAX_LINE_QUANTITY, MAX_ORDER_LINES } from "@/schemas/order";
import type { Product } from "@/schemas/product";

import {
  isProductInScope,
  loadProduct,
  readAvailable,
  resolveUnit,
  unitKey,
  unitPriceFor,
} from "./catalog-access";
import { defineTool, type ToolContext, type ToolOutcome } from "./types";

// The limits live in the pure order schema; re-exported so existing imports keep working.
export { MAX_LINE_QUANTITY, MAX_ORDER_LINES };
export const DELIVERY_NOTE = "Delivery charges are not available yet.";
const EXCLUDED_NOTE =
  "Lines with a flag are not in the subtotal. invalid_variant: ask which size or color. " +
  "insufficient_stock: offer the available quantity. out_of_scope or archived: say the item " +
  "is not offered.";

const LINE_FLAGS = ["out_of_scope", "archived", "invalid_variant", "insufficient_stock"] as const;

const inputSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(200),
        variantId: z.string().min(1).max(200).optional(),
        quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
      }),
    )
    .min(1)
    .max(MAX_ORDER_LINES),
  customerType: z.enum(["retail", "wholesale"]),
});
type TotalInput = z.output<typeof inputSchema>;

const outputSchema = z.object({
  customerType: z.enum(["retail", "wholesale"]),
  lines: z.array(
    z.object({
      productId: z.string(),
      variantId: z.string().optional(),
      name: z.string().optional(),
      quantity: z.number().int(),
      unitMinor: z.number().int().optional(),
      unitText: z.string().optional(),
      lineMinor: z.number().int().optional(),
      lineText: z.string().optional(),
      wholesaleFallback: z.boolean().optional(),
      flag: z.enum(LINE_FLAGS).optional(),
      available: z.number().int().optional(),
    }),
  ),
  subtotalMinor: z.number().int(),
  subtotalText: z.string(),
  excludedLines: z.number().int(),
  note: z.string().optional(),
  deliveryNote: z.string(),
});
type TotalOutput = z.output<typeof outputSchema>;
type Line = TotalOutput["lines"][number];

interface Prepared {
  item: TotalInput["items"][number];
  product?: Product;
  variantId?: string;
  flag?: (typeof LINE_FLAGS)[number];
}

async function run(ctx: ToolContext, input: TotalInput): Promise<ToolOutcome<TotalOutput>> {
  // 1. Products, once per distinct id (never trusts anything outside the organization).
  const ids = [...new Set(input.items.map((i) => i.productId))];
  const loaded = new Map<string, Product | null>(
    await Promise.all(
      ids.map(async (id) => [id, await loadProduct(ctx, id)] as [string, Product | null]),
    ),
  );

  // 2. Scope, status and unit of every line.
  const prepared: Prepared[] = input.items.map((item) => {
    const product = loaded.get(item.productId) ?? null;
    if (!product || !isProductInScope(ctx.agent, product)) return { item, flag: "out_of_scope" };
    if (product.availability !== "active") return { item, flag: "archived" };
    const unit = resolveUnit(product, item.variantId);
    const hasVariants = product.variants.length > 0;
    if (unit.kind === "invalid" || (hasVariants && unit.kind === "none")) {
      return { item, product, flag: "invalid_variant" };
    }
    return {
      item,
      product,
      variantId: unit.kind === "unit" ? unit.variantId : "default",
    };
  });

  // 3. One batched stock read for every sellable line.
  const available = await readAvailable(
    ctx,
    prepared.flatMap((p) =>
      p.product && !p.flag && p.variantId
        ? [{ productId: p.product.id, variantId: p.variantId }]
        : [],
    ),
  );

  // 4. Price the lines in order; repeated units draw on the same stock.
  const drawn = new Map<string, number>();
  let subtotalMinor = 0;
  let excludedLines = 0;
  const lines: Line[] = prepared.map((p) => {
    const line: Line = { productId: p.item.productId, quantity: p.item.quantity };
    if (p.item.variantId !== undefined) line.variantId = p.item.variantId;

    const exclude = (flag: (typeof LINE_FLAGS)[number]): Line => {
      excludedLines += 1;
      line.flag = flag;
      return line;
    };
    if (p.flag) {
      if (p.product) line.name = p.product.name;
      return exclude(p.flag);
    }
    const product = p.product!;
    line.name = product.name;

    const key = unitKey({ productId: product.id, variantId: p.variantId! });
    const stock = available.get(key) ?? 0;
    const already = drawn.get(key) ?? 0;
    if (already + p.item.quantity > stock) {
      line.available = Math.max(0, stock - already);
      return exclude("insufficient_stock");
    }
    drawn.set(key, already + p.item.quantity);

    const { unitMinor, wholesaleFallback } = unitPriceFor(product, input.customerType);
    const lineMinor = unitMinor * p.item.quantity;
    if (!Number.isSafeInteger(lineMinor)) throw new Error("Order line total out of range");
    subtotalMinor += lineMinor;
    line.unitMinor = unitMinor;
    line.unitText = formatMoneyMinor(unitMinor);
    line.lineMinor = lineMinor;
    line.lineText = formatMoneyMinor(lineMinor);
    if (wholesaleFallback) line.wholesaleFallback = true;
    return line;
  });
  if (!Number.isSafeInteger(subtotalMinor)) throw new Error("Order subtotal out of range");

  const data: TotalOutput = {
    customerType: input.customerType,
    lines,
    subtotalMinor,
    subtotalText: formatMoneyMinor(subtotalMinor),
    excludedLines,
    deliveryNote: DELIVERY_NOTE,
  };
  if (excludedLines > 0) data.note = EXCLUDED_NOTE;
  return { ok: true, data };
}

export const orderTotalTool = defineTool<TotalInput, TotalOutput>({
  name: "calculate_order_total",
  description:
    "Calculate the total of up to 20 order lines (productId, optional variantId, quantity) for " +
    "a retail or wholesale customer. Returns line totals and the subtotal in paisa and taka " +
    "text. Lines with a flag are NOT included in the subtotal (excludedLines counts them). " +
    "Flags: invalid_variant - ask which size or color; insufficient_stock - offer the " +
    "available quantity; out_of_scope or archived - say that item is not offered. Delivery " +
    "charges are not included. Always use this instead of doing the arithmetic yourself.",
  input: inputSchema,
  output: outputSchema,
  writes: false,
  run,
});
