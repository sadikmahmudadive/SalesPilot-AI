import { describe, expect, it } from "vitest";

import { forgotSchema, loginSchema, onboardingSchema, registerSchema } from "./auth";

const validRegister = {
  displayName: "Ada Lovelace",
  organizationName: "Analytical Engines Ltd",
  email: "ada@example.com",
  password: "correct-horse-battery",
  confirmPassword: "correct-horse-battery",
};

describe("registerSchema", () => {
  it("accepts valid input and trims names", () => {
    const parsed = registerSchema.parse({
      ...validRegister,
      displayName: "  Ada  ",
      organizationName: "  Acme Co  ",
    });
    expect(parsed.displayName).toBe("Ada");
    expect(parsed.organizationName).toBe("Acme Co");
  });

  it("rejects a password shorter than 10 characters", () => {
    const result = registerSchema.safeParse({
      ...validRegister,
      password: "short1234",
      confirmPassword: "short1234",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a password of exactly 10 and rejects one over 128", () => {
    const ten = "a".repeat(10);
    expect(
      registerSchema.safeParse({ ...validRegister, password: ten, confirmPassword: ten }).success,
    ).toBe(true);
    const long = "a".repeat(129);
    expect(
      registerSchema.safeParse({ ...validRegister, password: long, confirmPassword: long }).success,
    ).toBe(false);
  });

  it("rejects a whitespace-only organization name", () => {
    expect(registerSchema.safeParse({ ...validRegister, organizationName: "     " }).success).toBe(
      false,
    );
  });

  it("rejects a one-character organization name and one over 80", () => {
    expect(registerSchema.safeParse({ ...validRegister, organizationName: "A" }).success).toBe(
      false,
    );
    expect(
      registerSchema.safeParse({ ...validRegister, organizationName: "A".repeat(81) }).success,
    ).toBe(false);
  });

  it("rejects a whitespace-only or overlong display name", () => {
    expect(registerSchema.safeParse({ ...validRegister, displayName: "   " }).success).toBe(false);
    expect(
      registerSchema.safeParse({ ...validRegister, displayName: "A".repeat(81) }).success,
    ).toBe(false);
  });

  it("rejects an invalid email", () => {
    expect(registerSchema.safeParse({ ...validRegister, email: "not-an-email" }).success).toBe(
      false,
    );
  });

  it("rejects a mismatched confirmation and reports it on confirmPassword", () => {
    const result = registerSchema.safeParse({
      ...validRegister,
      confirmPassword: "different-password",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "confirmPassword")).toBe(true);
    }
  });
});

describe("loginSchema", () => {
  it("accepts a valid email and any non-empty password", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
  });
  it("rejects an invalid email and an empty password", () => {
    expect(loginSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });
});

describe("forgotSchema", () => {
  it("accepts a valid email and rejects an invalid one", () => {
    expect(forgotSchema.safeParse({ email: "a@b.co" }).success).toBe(true);
    expect(forgotSchema.safeParse({ email: "a@" }).success).toBe(false);
  });
});

describe("onboardingSchema", () => {
  it("requires trimmed display and organization names", () => {
    expect(
      onboardingSchema.safeParse({ displayName: "Ada", organizationName: "Acme" }).success,
    ).toBe(true);
    expect(onboardingSchema.safeParse({ displayName: "Ada", organizationName: "  " }).success).toBe(
      false,
    );
    expect(onboardingSchema.safeParse({ displayName: " ", organizationName: "Acme" }).success).toBe(
      false,
    );
  });
});
