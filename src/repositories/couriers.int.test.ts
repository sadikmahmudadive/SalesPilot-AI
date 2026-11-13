import { describe, expect, it } from "vitest";

import {
  createCourierAccount,
  deleteCourierAccount,
  getCachedLocations,
  getCourierAccount,
  getDefaultCourierAccount,
  getEnabledCourierAccounts,
  listCourierAccounts,
  setCachedLocations,
  updateCourierAccount,
} from "./couriers";

function dummyCourierAccount(orgId: string, label = "Test Courier", isDefault = false) {
  return {
    organizationId: orgId,
    provider: "mock" as const,
    label,
    mode: "mock" as const,
    enabled: true,
    isDefault,
    credentials: {
      v: 1 as const,
      iv: "iv==",
      tag: "tag==",
      data: "data==",
    },
    publicConfig: {},
  };
}

describe("couriers repository", () => {
  it("creates, reads, updates, and deletes a courier account", async () => {
    const orgId = "org_courier_repo_1";
    const created = await createCourierAccount(dummyCourierAccount(orgId, "Steadfast 1"));

    expect(created.id).toBeTypeOf("string");
    expect(created.organizationId).toBe(orgId);

    const fetched = await getCourierAccount(orgId, created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.label).toBe("Steadfast 1");

    // Other org cannot read it
    const otherOrgFetched = await getCourierAccount("other_org", created.id);
    expect(otherOrgFetched).toBeNull();

    // Update
    const updated = await updateCourierAccount(orgId, created.id, {
      label: "Steadfast Updated",
      enabled: false,
    });
    expect(updated.label).toBe("Steadfast Updated");
    expect(updated.enabled).toBe(false);

    // Delete
    await deleteCourierAccount(orgId, created.id);
    const afterDelete = await getCourierAccount(orgId, created.id);
    expect(afterDelete).toBeNull();
  });

  it("lists accounts strictly scoped to organization", async () => {
    const orgA = "org_courier_list_A";
    const orgB = "org_courier_list_B";

    await createCourierAccount(dummyCourierAccount(orgA, "A1"));
    await createCourierAccount(dummyCourierAccount(orgA, "A2"));
    await createCourierAccount(dummyCourierAccount(orgB, "B1"));

    const listA = await listCourierAccounts(orgA);
    const listB = await listCourierAccounts(orgB);

    expect(listA.map((a) => a.label)).toEqual(["A1", "A2"]);
    expect(listB.map((a) => a.label)).toEqual(["B1"]);
  });

  it("maintains at most one default courier account per organization", async () => {
    const orgId = "org_courier_default_test";

    const c1 = await createCourierAccount(dummyCourierAccount(orgId, "C1", true));
    expect(c1.isDefault).toBe(true);

    const def1 = await getDefaultCourierAccount(orgId);
    expect(def1?.id).toBe(c1.id);

    // Creating C2 as default unsets C1
    const c2 = await createCourierAccount(dummyCourierAccount(orgId, "C2", true));
    expect(c2.isDefault).toBe(true);

    const c1Refreshed = await getCourierAccount(orgId, c1.id);
    expect(c1Refreshed?.isDefault).toBe(false);

    const def2 = await getDefaultCourierAccount(orgId);
    expect(def2?.id).toBe(c2.id);

    // Updating C1 back to default unsets C2
    await updateCourierAccount(orgId, c1.id, { isDefault: true });
    const c2Refreshed = await getCourierAccount(orgId, c2.id);
    expect(c2Refreshed?.isDefault).toBe(false);

    const def3 = await getDefaultCourierAccount(orgId);
    expect(def3?.id).toBe(c1.id);
  });

  it("filters enabled courier accounts", async () => {
    const orgId = "org_courier_enabled_test";
    const a1 = await createCourierAccount(dummyCourierAccount(orgId, "Enabled 1"));
    const a2 = await createCourierAccount(dummyCourierAccount(orgId, "Disabled 1"));
    await updateCourierAccount(orgId, a2.id, { enabled: false });

    const enabledList = await getEnabledCourierAccounts(orgId);
    expect(enabledList.map((a) => a.id)).toEqual([a1.id]);
  });

  it("caches and retrieves location hierarchies", async () => {
    const orgId = "org_courier_locations_test";
    const cities = [
      { id: "1", name: "Dhaka" },
      { id: "2", name: "Chittagong" },
    ];

    // Cache miss
    const miss = await getCachedLocations(orgId, "pathao", "city");
    expect(miss).toBeNull();

    // Set cache
    await setCachedLocations(orgId, "pathao", "city", undefined, cities);

    // Cache hit
    const hit = await getCachedLocations(orgId, "pathao", "city");
    expect(hit).toEqual(cities);

    // Child levels with parentId
    const zones = [{ id: "101", name: "Dhanmondi" }];
    await setCachedLocations(orgId, "pathao", "zone", "1", zones);
    const zonesHit = await getCachedLocations(orgId, "pathao", "zone", "1");
    expect(zonesHit).toEqual(zones);
  });
});
