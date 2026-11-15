import { describe, expect, it } from "vitest";

import { createCourierAccount, getCachedLocations } from "@/repositories/couriers";
import { getCourierLocations } from "./locations";

describe("getCourierLocations", () => {
  it("fetches locations via adapter and populates cache", async () => {
    const orgId = "org_loc_test_1";

    // Setup an enabled mock account
    await createCourierAccount({
      organizationId: orgId,
      provider: "mock",
      label: "Mock Courier",
      mode: "mock",
      enabled: true,
      isDefault: true,
      credentials: { v: 1, iv: "iv", tag: "tag", data: "data" },
      publicConfig: {},
    });

    // 1. Initial fetch -> cache miss -> adapter called -> cache populated
    const cities = await getCourierLocations(orgId, "mock", "city");
    expect(cities).toEqual([
      { id: "1", name: "Dhaka" },
      { id: "2", name: "Chittagong" },
    ]);

    // Check DB cache directly
    const cached = await getCachedLocations(orgId, "mock", "city");
    expect(cached).toEqual(cities);

    // 2. Subsequent fetch -> cache hit
    const citiesCached = await getCourierLocations(orgId, "mock", "city");
    expect(citiesCached).toEqual(cities);

    // 3. Child levels
    const zones = await getCourierLocations(orgId, "mock", "zone", "1");
    expect(zones).toHaveLength(2);
  });

  it("throws NotFoundError when no enabled account is found", async () => {
    const orgId = "org_loc_test_no_account";
    await expect(getCourierLocations(orgId, "mock", "city")).rejects.toThrow(
      "No active mock courier account configured",
    );
  });
});
