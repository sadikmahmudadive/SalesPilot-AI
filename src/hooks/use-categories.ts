"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";

import { categoryKeys } from "@/hooks/query-keys";
import { apiFetch } from "@/lib/api/client";
import type { Category, categoryInputSchema } from "@/schemas/product";

export type CategoryCreateBody = z.input<typeof categoryInputSchema>;

/** All categories (the API returns up to 200, sorted by name, without pagination). */
export function useCategories() {
  return useQuery({
    queryKey: categoryKeys.all,
    queryFn: async ({ signal }) => (await apiFetch<{ items: Category[] }>("/api/categories", { signal })).items,
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CategoryCreateBody) => apiFetch<Category>("/api/categories", { method: "POST", body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: categoryKeys.all }),
  });
}
