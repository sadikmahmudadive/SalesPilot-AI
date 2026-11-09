"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useCategories } from "@/hooks/use-categories";

interface ProductAccessFieldProps {
  mode: "all" | "categories";
  categoryIds: string[];
  onModeChange: (mode: "all" | "categories") => void;
  onCategoryIdsChange: (categoryIds: string[]) => void;
  disabled?: boolean;
}

export function ProductAccessField({
  mode,
  categoryIds,
  onModeChange,
  onCategoryIdsChange,
  disabled,
}: ProductAccessFieldProps) {
  const categoriesQuery = useCategories();
  const categories = categoriesQuery.data ?? [];
  const selectedSet = new Set(categoryIds);

  const toggleCategory = (id: string) => {
    if (disabled) return;
    if (selectedSet.has(id)) {
      onCategoryIdsChange(categoryIds.filter((cid) => cid !== id));
    } else {
      if (categoryIds.length >= 20) return;
      onCategoryIdsChange([...categoryIds, id]);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <label
          className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
            mode === "all" ? "border-primary/50 bg-primary/5" : "border-border"
          } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
        >
          <input
            type="radio"
            name="productAccessMode"
            className="mt-1 h-4 w-4 border-gray-300 text-primary focus:ring-primary"
            checked={mode === "all"}
            onChange={() => onModeChange("all")}
            disabled={disabled}
          />
          <div>
            <span className="text-sm font-medium">All products</span>
            <p className="text-xs text-muted-foreground">
              The agent has access to all active, non-archived products in your shop.
            </p>
          </div>
        </label>

        <label
          className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
            mode === "categories" ? "border-primary/50 bg-primary/5" : "border-border"
          } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
        >
          <input
            type="radio"
            name="productAccessMode"
            className="mt-1 h-4 w-4 border-gray-300 text-primary focus:ring-primary"
            checked={mode === "categories"}
            onChange={() => onModeChange("categories")}
            disabled={disabled}
          />
          <div>
            <span className="text-sm font-medium">Specific categories only</span>
            <p className="text-xs text-muted-foreground">
              Restrict the agent to products belonging to selected categories (up to 20).
            </p>
          </div>
        </label>
      </div>

      {mode === "categories" ? (
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <p className="text-xs font-medium text-muted-foreground">
            Select categories ({categoryIds.length}/20 selected):
          </p>

          {categoriesQuery.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-5 w-32" />
            </div>
          ) : categories.length === 0 ? (
            <p className="text-xs text-muted-foreground">No categories created yet in your shop.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {categories.map((c) => {
                const isChecked = selectedSet.has(c.id);
                return (
                  <label
                    key={c.id}
                    className={`flex cursor-pointer items-center gap-2 rounded p-1.5 text-sm ${
                      isChecked ? "bg-muted font-medium" : "hover:bg-muted/50"
                    } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-primary"
                      checked={isChecked}
                      onChange={() => toggleCategory(c.id)}
                      disabled={disabled}
                    />
                    <span>{c.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
