import { describe, expect, it } from "vitest";

import { registerOrganizationSchema } from "./organization";

describe("registerOrganizationSchema", () => {
  it("trims and accepts valid input", () => {
    expect(registerOrganizationSchema.parse({ organizationName: "  Acme Co  ", displayName: " Jo " })).toEqual({
      organizationName: "Acme Co",
      displayName: "Jo",
    });
  });

  it.each([
    [{ organizationName: "A", displayName: "Jo" }],
    [{ organizationName: " A ", displayName: "Jo" }],
    [{ organizationName: "x".repeat(81), displayName: "Jo" }],
    [{ organizationName: "Acme", displayName: "   " }],
    [{ organizationName: "Acme", displayName: "x".repeat(81) }],
    [{ organizationName: "Acme" }],
    [{ organizationName: 5, displayName: "Jo" }],
  ])("rejects %j", (input) => {
    expect(registerOrganizationSchema.safeParse(input).success).toBe(false);
  });

  it("strips uid/email/organizationId smuggled in the body", () => {
    const out = registerOrganizationSchema.parse({
      organizationName: "Acme",
      displayName: "Jo",
      uid: "victim",
      email: "v@x.com",
      organizationId: "other",
    });
    expect(out).toEqual({ organizationName: "Acme", displayName: "Jo" });
  });
});
