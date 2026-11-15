/**
 * `get_product_details`: description, variants, specifications and FAQs of one product the agent
 * may see. Anything else (missing, other organization, draft, archived, out of scope) is the same
 * `not_found`. Results are bounded and never carry internal fields. Server-only.
 */
import "server-only";

import { z } from "zod";

import { formatMoneyMinor } from "@/lib/format";
import { isValidIdSegment } from "@/lib/ids";
import { truncateUnits } from "@/lib/text";
import { categoryRepo } from "@/repositories/categories";

import { loadVisibleProduct, retailMinor } from "./catalog-access";
import { defineTool, toolFailure, type ToolContext, type ToolOutcome } from "./types";

export const MAX_DESCRIPTION_CHARS = 2000;
export const MAX_DETAIL_SPECS = 20;
export const MAX_DETAIL_FAQS = 10;

const inputSchema = z.object({
  productId: z.string().min(1).max(200).describe("The productId returned by search_products."),
});
type DetailsInput = z.output<typeof inputSchema>;

const outputSchema = z.object({
  productId: z.string(),
  name: z.string(),
  sku: z.string(),
  category: z.string().optional(),
  description: z.string().optional(),
  priceText: z.string(),
  variants: z.array(
    z.object({ id: z.string(), size: z.string().optional(), color: z.string().optional() }),
  ),
  specifications: z.array(z.object({ name: z.string(), value: z.string() })),
  faqs: z.array(z.object({ q: z.string(), a: z.string() })),
});
type DetailsOutput = z.output<typeof outputSchema>;

async function run(ctx: ToolContext, input: DetailsInput): Promise<ToolOutcome<DetailsOutput>> {
  const product = await loadVisibleProduct(ctx, input.productId);
  if (!product) return toolFailure("not_found");

  let category: string | undefined;
  if (product.categoryId !== undefined && isValidIdSegment(product.categoryId)) {
    category = (await categoryRepo.get(ctx.organizationId, product.categoryId))?.name;
  }

  const data: DetailsOutput = {
    productId: product.id,
    name: product.name,
    sku: product.sku,
    priceText: formatMoneyMinor(retailMinor(product)),
    variants: product.variants.map((v) => ({
      id: v.id,
      ...(v.size !== undefined ? { size: v.size } : {}),
      ...(v.color !== undefined ? { color: v.color } : {}),
    })),
    specifications: Object.entries(product.specifications ?? {})
      .filter((e): e is [string, string] => typeof e[1] === "string")
      .slice(0, MAX_DETAIL_SPECS)
      .map(([name, value]) => ({ name, value })),
    faqs: (product.faqs ?? []).slice(0, MAX_DETAIL_FAQS).map((f) => ({ q: f.q, a: f.a })),
  };
  if (category !== undefined) data.category = category;
  if (product.description) {
    data.description = truncateUnits(product.description, MAX_DESCRIPTION_CHARS);
  }
  return { ok: true, data };
}

export const productDetailsTool = defineTool<DetailsInput, DetailsOutput>({
  name: "get_product_details",
  description:
    "Get the description, variants (size and color), specifications and FAQs of one product by " +
    "its productId. Use it to answer questions about a specific product.",
  input: inputSchema,
  output: outputSchema,
  writes: false,
  run,
});
