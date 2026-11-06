import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
const getMembership = vi.fn();
const getOrganization = vi.fn();
const getUserDisplayName = vi.fn();

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/repositories/organizations", () => ({
  getMembership: (uid: string) => getMembership(uid),
  getOrganization: (id: string) => getOrganization(id),
  getUserDisplayName: (uid: string) => getUserDisplayName(uid),
}));

import { loadDashboardContext } from "./dashboard-context";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadDashboardContext", () => {
  it("is unauthenticated without a valid session and reads nothing else", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect(await loadDashboardContext()).toEqual({ status: "unauthenticated" });
    expect(getMembership).not.toHaveBeenCalled();
  });

  it("reports no-organization when there is no membership", async () => {
    getCurrentUser.mockResolvedValue({ uid: "u1", email: "a@b.co" });
    getMembership.mockResolvedValue(null);
    expect(await loadDashboardContext()).toEqual({ status: "no-organization", email: "a@b.co" });
    expect(getOrganization).not.toHaveBeenCalled();
  });

  it("returns org name, role and profile for a member", async () => {
    getCurrentUser.mockResolvedValue({ uid: "u1", email: "a@b.co" });
    getMembership.mockResolvedValue({ organizationId: "o1", role: "admin" });
    getOrganization.mockResolvedValue({ id: "o1", name: "Acme" });
    getUserDisplayName.mockResolvedValue("Ada");
    expect(await loadDashboardContext()).toEqual({
      status: "ready",
      uid: "u1",
      email: "a@b.co",
      displayName: "Ada",
      organizationId: "o1",
      organizationName: "Acme",
      role: "admin",
    });
  });

  it("uses a neutral organization name when the organization document is missing", async () => {
    getCurrentUser.mockResolvedValue({ uid: "u1", email: null });
    getMembership.mockResolvedValue({ organizationId: "o1", role: "viewer" });
    getOrganization.mockResolvedValue(null);
    getUserDisplayName.mockResolvedValue(null);
    const ctx = await loadDashboardContext();
    expect(ctx).toMatchObject({ status: "ready", organizationName: "Your organization", displayName: null });
  });
});
