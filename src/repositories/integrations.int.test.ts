import { describe, expect, it } from "vitest";

import {
  createGatewayAccount,
  deleteGatewayAccount,
  getDefaultGatewayAccount,
  getGatewayAccount,
  listGatewayAccounts,
  updateGatewayAccount,
} from "./integrations";

function dummyAccountData(orgId: string, label = "Test Gateway", isDefault = false) {
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

describe("integrations repository", () => {
  it("creates, reads, and deletes a gateway account", async () => {
    const orgId = "org_repo_test_1";
    const created = await createGatewayAccount(dummyAccountData(orgId, "Mock 1"));

    expect(created.id).toBeTypeOf("string");
    expect(created.organizationId).toBe(orgId);

    const fetched = await getGatewayAccount(orgId, created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.label).toBe("Mock 1");

    // Other org cannot read it
    const otherOrgFetched = await getGatewayAccount("other_org", created.id);
    expect(otherOrgFetched).toBeNull();

    await deleteGatewayAccount(orgId, created.id);
    const afterDelete = await getGatewayAccount(orgId, created.id);
    expect(afterDelete).toBeNull();
  });

  it("lists accounts strictly scoped to organization", async () => {
    const orgA = "org_list_A";
    const orgB = "org_list_B";

    await createGatewayAccount(dummyAccountData(orgA, "A1"));
    await createGatewayAccount(dummyAccountData(orgA, "A2"));
    await createGatewayAccount(dummyAccountData(orgB, "B1"));

    const listA = await listGatewayAccounts(orgA);
    const listB = await listGatewayAccounts(orgB);

    expect(listA.every((a) => a.organizationId === orgA)).toBe(true);
    expect(listA.length).toBeGreaterThanOrEqual(2);
    expect(listB.every((a) => a.organizationId === orgB)).toBe(true);
    expect(listB.length).toBeGreaterThanOrEqual(1);
  });

  it("enforces single default gateway per organization", async () => {
    const orgId = "org_default_test";

    const a1 = await createGatewayAccount(dummyAccountData(orgId, "A1", true));
    let def = await getDefaultGatewayAccount(orgId);
    expect(def?.id).toBe(a1.id);

    // Creating A2 as default unsets A1
    const a2 = await createGatewayAccount(dummyAccountData(orgId, "A2", true));
    def = await getDefaultGatewayAccount(orgId);
    expect(def?.id).toBe(a2.id);

    const reloadedA1 = await getGatewayAccount(orgId, a1.id);
    expect(reloadedA1?.isDefault).toBe(false);

    // Updating A1 to default unsets A2
    await updateGatewayAccount(orgId, a1.id, { isDefault: true });
    def = await getDefaultGatewayAccount(orgId);
    expect(def?.id).toBe(a1.id);

    const reloadedA2 = await getGatewayAccount(orgId, a2.id);
    expect(reloadedA2?.isDefault).toBe(false);
  });
});
