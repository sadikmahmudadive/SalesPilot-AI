"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useFieldArray, useWatch, type FieldPath, type UseFormReturn } from "react-hook-form";

import { TextField } from "@/components/auth/text-field";
import {
  EMPTY_ORDER_LINE,
  errorMessageAt,
  retailPriceMinor,
  stockUnitId,
  variantLabel,
  type OrderFormValues,
} from "@/components/orders/order-form-model";
import { FieldError, SelectField } from "@/components/shared/form-controls";
import { Button } from "@/components/ui/button";
import { productKeys } from "@/hooks/query-keys";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useInventory } from "@/hooks/use-inventory";
import { useProducts } from "@/hooks/use-products";
import { formatMoneyMinor } from "@/lib/format";
import { MAX_LINE_QUANTITY, MAX_ORDER_LINES } from "@/schemas/order";
import type { Product } from "@/schemas/product";

const SEARCH_DEBOUNCE_MS = 300;
const RESULT_LIMIT = 8;

type Form = UseFormReturn<OrderFormValues>;

function ProductSearch({ onPick, disabled }: { onPick: (p: Product) => void; disabled?: boolean }) {
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const query = useProducts({ q, availability: "active", limit: RESULT_LIMIT });
  const results = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-2">
      <TextField
        label="Product"
        placeholder="Search products by name"
        autoComplete="off"
        value={search}
        disabled={disabled}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div aria-live="polite" className="text-sm">
        {query.isPending ? (
          <p className="text-muted-foreground">Loading products…</p>
        ) : query.isError ? (
          <p className="text-destructive">Products could not be loaded. Try searching again.</p>
        ) : results.length === 0 ? (
          <p className="text-muted-foreground">No active product matches that search.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {results.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(p)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none disabled:opacity-50"
                >
                  <span className="truncate font-medium">{p.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatMoneyMinor(retailPriceMinor(p))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Available stock of the chosen unit, from the inventory list (kept fresh by the query cache). */
function StockHint({
  product,
  variantId,
  quantity,
}: {
  product: Product;
  variantId: string;
  quantity: number;
}) {
  const query = useInventory({ productId: product.id, limit: 50 });
  if (product.variants.length > 0 && variantId === "") {
    return <span className="text-muted-foreground">Choose a variant to see stock.</span>;
  }
  if (query.isPending) return <span className="text-muted-foreground">Checking stock…</span>;
  if (query.isError) return <span className="text-muted-foreground">Stock is unavailable.</span>;

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const available = Math.max(
    0,
    items.find((i) => i.variantId === stockUnitId(variantId))?.available ?? 0,
  );
  const short = Number.isInteger(quantity) && quantity > available;
  return (
    <span className={short ? "text-destructive" : "text-muted-foreground"}>
      {short ? `Only ${available} available` : `${available} available`}
    </span>
  );
}

interface LineRowProps {
  form: Form;
  index: number;
  products: ReadonlyMap<string, Product>;
  productLoading: boolean;
  disabled?: boolean;
  onRemove: () => void;
}

function LineRow({ form, index, products, productLoading, disabled, onRemove }: LineRowProps) {
  const queryClient = useQueryClient();
  const { control, register, setValue, clearErrors, formState } = form;
  const line = useWatch({ control, name: `lines.${index}` });
  const product = line?.productId ? products.get(line.productId) : undefined;
  const name = (field: string) => `lines.${index}.${field}` as FieldPath<OrderFormValues>;
  const message = (field: string): string | undefined =>
    errorMessageAt(formState.errors, name(field));

  function pick(p: Product) {
    queryClient.setQueryData(productKeys.detail(p.id), p);
    setValue(name("productId"), p.id, { shouldDirty: true });
    // A product with exactly one variant needs no choosing.
    setValue(name("variantId"), p.variants.length === 1 ? p.variants[0]!.id : "", {
      shouldDirty: true,
    });
    clearErrors(`lines.${index}`);
  }

  function change() {
    setValue(name("productId"), "", { shouldDirty: true });
    setValue(name("variantId"), "", { shouldDirty: true });
  }

  const quantity = Number(line?.quantity?.trim() ?? "");
  const rowError = message("root");

  return (
    <fieldset className="m-0 min-w-0 space-y-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Item {index + 1}</legend>

      {!line?.productId ? (
        <>
          <ProductSearch onPick={pick} disabled={disabled} />
          <FieldError id={`line-${index}-product-error`} message={message("productId")} />
        </>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              {product ? (
                <>
                  <p className="truncate text-sm font-medium">{product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{product.sku}</span>
                    {" · "}
                    {formatMoneyMinor(retailPriceMinor(product))} each
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {productLoading ? "Loading product…" : "This product could not be loaded."}
                </p>
              )}
            </div>
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={change}>
              Change product
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {product && product.variants.length > 0 ? (
              <SelectField
                label="Variant"
                placeholder="Choose a variant"
                value={line.variantId}
                disabled={disabled}
                onValueChange={(v) => {
                  setValue(name("variantId"), v, { shouldDirty: true });
                  clearErrors(name("variantId"));
                  clearErrors(name("root"));
                }}
                options={product.variants.map((v) => ({ value: v.id, label: variantLabel(v) }))}
                error={message("variantId")}
              />
            ) : null}
            <TextField
              label="Quantity"
              inputMode="numeric"
              autoComplete="off"
              maxLength={String(MAX_LINE_QUANTITY).length}
              disabled={disabled}
              error={message("quantity")}
              {...register(name("quantity") as `lines.${number}.quantity`, {
                onChange: () => {
                  clearErrors(name("quantity"));
                  clearErrors(name("root"));
                },
              })}
            />
          </div>

          <div
            className="flex flex-wrap items-center justify-between gap-2 text-xs"
            aria-live="polite"
          >
            {product ? (
              <StockHint product={product} variantId={line.variantId} quantity={quantity} />
            ) : (
              <span />
            )}
            {product && Number.isInteger(quantity) && quantity > 0 ? (
              <span className="text-muted-foreground tabular-nums">
                Line total {formatMoneyMinor(retailPriceMinor(product) * quantity)}
              </span>
            ) : null}
          </div>
        </div>
      )}

      <FieldError id={`line-${index}-error`} message={rowError} />

      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onRemove}>
          <Trash2 aria-hidden="true" />
          Remove item {index + 1}
        </Button>
      </div>
    </fieldset>
  );
}

interface LineEditorProps {
  form: Form;
  /** Every product on a line that has loaded, by id. */
  products: ReadonlyMap<string, Product>;
  productsLoading: boolean;
  disabled?: boolean;
}

/** The order's item rows: product search, variant, quantity, price and stock, up to the order limit. */
export function LineEditor({ form, products, productsLoading, disabled }: LineEditorProps) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const rootError = errorMessageAt(form.formState.errors, "lines.root");

  return (
    <div className="space-y-3">
      {fields.map((field, index) => (
        <LineRow
          key={field.id}
          form={form}
          index={index}
          products={products}
          productLoading={productsLoading}
          disabled={disabled}
          onRemove={() => remove(index)}
        />
      ))}
      <FieldError id="lines-error" message={rootError} />
      <Button
        type="button"
        variant="outline"
        disabled={disabled || fields.length >= MAX_ORDER_LINES}
        onClick={() => {
          form.clearErrors("lines");
          append({ ...EMPTY_ORDER_LINE });
        }}
      >
        <Plus aria-hidden="true" />
        Add item
      </Button>
      {fields.length >= MAX_ORDER_LINES ? (
        <p className="text-xs text-muted-foreground">
          An order can have up to {MAX_ORDER_LINES} items.
        </p>
      ) : null}
    </div>
  );
}
