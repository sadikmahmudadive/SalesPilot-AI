/**
 * TanStack Query keys for the catalogue. Kept together because mutations in one area refresh
 * data in another (adjusting stock refreshes the product, editing a product refreshes inventory
 * rows that show its name and variant labels).
 */
export const productKeys = {
  all: ["products"] as const,
  lists: () => [...productKeys.all, "list"] as const,
  list: (params: object) => [...productKeys.lists(), params] as const,
  detail: (id: string) => [...productKeys.all, "detail", id] as const,
};

export const categoryKeys = {
  all: ["categories"] as const,
};

export const inventoryKeys = {
  all: ["inventory"] as const,
  lists: () => [...inventoryKeys.all, "list"] as const,
  list: (params: object) => [...inventoryKeys.lists(), params] as const,
};

export const agentKeys = {
  all: ["agents"] as const,
  lists: () => [...agentKeys.all, "list"] as const,
  list: (params: object) => [...agentKeys.lists(), params] as const,
  detail: (id: string) => [...agentKeys.all, "detail", id] as const,
};
