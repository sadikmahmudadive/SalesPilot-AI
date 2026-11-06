import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
const getMembership = vi.fn();
const getOrganization = vi.fn();
const getUserDisplayName = vi.fn();

const headerStore = new Map<string, string>();
class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`REDIRECT:${url}`);
  }
}
const redirect = vi.fn((url: string): never => {
  throw new RedirectSignal(url);
});

vi.mock("next/headers", () => ({ headers: async () => ({ get: (name: string) => headerStore.get(name) ?? null }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/repositories/organizations", () => ({
  getMembership: (uid: string) => getMembership(uid),
  getOrganization: (id: string) => getOrganization(id),
  getUserDisplayName: (uid: string) => getUserDisplayName(uid),
}));

import { loadDashboardContext, redirectToExpiredSession, requireDashboardContext } from "./dashboard-context";

beforeEach(() => {
  vi.clearAllMocks();
  headerStore.clear();
});

async function redirectUrl(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof RedirectSignal) return error.url;
    throw error;
  }
  throw new Error("expected a redirect");
}

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

describe("redirectToExpiredSession", () => {
  it("redirects to /api/auth/expired with the encoded requested path", async () => {
    headerStore.set("x-sp-path", "/orders/42?tab=items");
    expect(await redirectUrl(redirectToExpiredSession)).toBe(
      "/api/auth/expired?next=" + encodeURIComponent("/orders/42?tab=items"),
    );
  });

  it("falls back to /dashboard when the header is absent", async () => {
    expect(await redirectUrl(redirectToExpiredSession)).toBe("/api/auth/expired?next=%2Fdashboard");
  });

  it.each(["//evil.com", "https://evil.com", "/ok\r\nSet-Cookie: x=1", "/\\evil.com", "javascript:alert(1)"])(
    "replaces a hostile x-sp-path (%j) with /dashboard",
    async (hostile) => {
      headerStore.set("x-sp-path", hostile);
      expect(await redirectUrl(redirectToExpiredSession)).toBe("/api/auth/expired?next=%2Fdashboard");
    },
  );
});

describe("requireDashboardContext", () => {
  it("redirects an unauthenticated visitor to /api/auth/expired", async () => {
    getCurrentUser.mockResolvedValue(null);
    headerStore.set("x-sp-path", "/settings");
    expect(await redirectUrl(requireDashboardContext)).toBe("/api/auth/expired?next=%2Fsettings");
  });

  it("returns null without redirecting for a signed-in user without an organization", async () => {
    getCurrentUser.mockResolvedValue({ uid: "u1", email: "a@b.co" });
    getMembership.mockResolvedValue(null);
    expect(await requireDashboardContext()).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("returns the ready context for a member", async () => {
    getCurrentUser.mockResolvedValue({ uid: "u1", email: "a@b.co" });
    getMembership.mockResolvedValue({ organizationId: "o1", role: "agent" });
    getOrganization.mockResolvedValue({ id: "o1", name: "Acme" });
    getUserDisplayName.mockResolvedValue("Ada");
    expect(await requireDashboardContext()).toMatchObject({
      status: "ready",
      organizationId: "o1",
      organizationName: "Acme",
      role: "agent",
    });
    expect(redirect).not.toHaveBeenCalled();
  });
});
