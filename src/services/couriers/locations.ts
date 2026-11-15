import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  COURIER_PROVIDERS,
  type CourierAccount,
  type CourierLocation,
  type CourierProvider,
} from "@/schemas/courier";

import {
  getCachedLocations,
  getEnabledCourierAccounts,
  setCachedLocations,
} from "@/repositories/couriers";
import { getCourierAdapter } from "./registry";

export async function getCourierLocations(
  organizationId: string,
  provider: CourierProvider,
  level: "city" | "zone" | "area" = "city",
  parentId?: string,
  explicitAccount?: CourierAccount,
): Promise<CourierLocation[]> {
  if (!COURIER_PROVIDERS.includes(provider)) {
    throw new ValidationError(undefined, `Invalid courier provider: ${provider}`);
  }

  // 1. Try cache first
  const cached = await getCachedLocations(organizationId, provider, level, parentId);
  if (cached) {
    return cached;
  }

  // 2. Resolve courier account to make external call
  let account = explicitAccount;
  if (!account) {
    const enabled = await getEnabledCourierAccounts(organizationId);
    const matching = enabled.filter((a) => a.provider === provider);
    account = matching.find((a) => a.isDefault) ?? matching[0];
  }

  if (!account) {
    throw new NotFoundError(`No active ${provider} courier account configured`);
  }

  // 3. Adapter call
  const adapter = getCourierAdapter(provider);
  if (!adapter.listLocations) {
    return [];
  }

  const items = await adapter.listLocations(account, level, parentId);

  // 4. Save to cache
  await setCachedLocations(organizationId, provider, level, parentId, items);

  return items;
}
