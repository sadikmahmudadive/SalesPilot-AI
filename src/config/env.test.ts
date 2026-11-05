import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetEnvCacheForTests, getServerEnv, isConfigured, isEmulator } from "./env";

const ALL_KEYS = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_AUTH_EMULATOR_HOST",
  "NODE_ENV",
  "SESSION_COOKIE_MAX_DAYS",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_BUSINESS_ACCOUNT_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
  "META_GRAPH_API_VERSION",
  "OPENAI_API_KEY",
  "OPENAI_CHAT_MODEL",
  "OPENAI_REALTIME_MODEL",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "TWILIO_WEBHOOK_SECRET",
  "SSLCOMMERZ_STORE_ID",
  "SSLCOMMERZ_STORE_PASSWORD",
  "SSLCOMMERZ_IS_LIVE",
  "N8N_WEBHOOK_URL",
  "N8N_WEBHOOK_SECRET",
  "ENCRYPTION_KEY",
  "CRON_SECRET",
];

function stubAll(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

const SERVER_VALUES = {
  FIREBASE_PROJECT_ID: "demo-salespilot",
  FIREBASE_CLIENT_EMAIL: "svc@demo-salespilot.iam.gserviceaccount.com",
  FIREBASE_PRIVATE_KEY: "-----BEGIN KEY-----\\nabc\\n-----END KEY-----\\n",
};

beforeEach(() => {
  // Start from a clean slate so the host environment never leaks into a case.
  for (const key of ALL_KEYS) vi.stubEnv(key, undefined);
  __resetEnvCacheForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetEnvCacheForTests();
});

describe("getServerEnv", () => {
  it("throws naming FIREBASE_PROJECT_ID when it is missing, without leaking secret values", () => {
    stubAll({
      FIREBASE_CLIENT_EMAIL: "svc@example.com",
      FIREBASE_PRIVATE_KEY: "sk-secret",
      CLOUDINARY_API_SECRET: "sk-secret",
    });
    let message = "";
    try {
      getServerEnv();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("FIREBASE_PROJECT_ID");
    expect(message).not.toContain("sk-secret");
  });

  it("lists every invalid variable name and never the invalid values", () => {
    stubAll({
      ...SERVER_VALUES,
      SESSION_COOKIE_MAX_DAYS: "999-sk-secret",
    });
    vi.stubEnv("FIREBASE_PROJECT_ID", undefined);
    let message = "";
    try {
      getServerEnv();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("FIREBASE_PROJECT_ID");
    expect(message).toContain("SESSION_COOKIE_MAX_DAYS");
    expect(message).not.toContain("sk-secret");
  });

  it("does not require service-account credentials when both emulator hosts are set", () => {
    stubAll({
      FIREBASE_PROJECT_ID: "demo-salespilot",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8085",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9199",
    });
    expect(() => getServerEnv()).not.toThrow();
    expect(isEmulator()).toBe(true);
  });

  it("throws naming FIREBASE_AUTH_EMULATOR_HOST when only the Firestore host is set", () => {
    stubAll({
      FIREBASE_PROJECT_ID: "demo-salespilot",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8085",
    });
    let message = "";
    try {
      getServerEnv();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("FIREBASE_AUTH_EMULATOR_HOST");
    expect(message).not.toContain("127.0.0.1");
    expect(isEmulator()).toBe(false);
  });

  it("throws naming FIRESTORE_EMULATOR_HOST when only the Auth host is set", () => {
    stubAll({
      FIREBASE_PROJECT_ID: "demo-salespilot",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9199",
    });
    let message = "";
    try {
      getServerEnv();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("FIRESTORE_EMULATOR_HOST");
    expect(message).not.toContain("127.0.0.1");
    expect(isEmulator()).toBe(false);
  });

  it("rejects emulator hosts in production, naming variables only", () => {
    stubAll({
      ...SERVER_VALUES,
      NODE_ENV: "production",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8085",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9199",
    });
    let message = "";
    try {
      getServerEnv();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("FIRESTORE_EMULATOR_HOST");
    expect(message).toContain("FIREBASE_AUTH_EMULATOR_HOST");
    expect(message).not.toContain("127.0.0.1");
    expect(isEmulator()).toBe(false);
  });

  it("accepts a production environment with credentials and no emulator hosts", () => {
    stubAll({ ...SERVER_VALUES, NODE_ENV: "production" });
    expect(() => getServerEnv()).not.toThrow();
  });

  it("requires FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY outside the emulator", () => {
    stubAll({ FIREBASE_PROJECT_ID: "demo-salespilot" });
    expect(isEmulator()).toBe(false);
    expect(() => getServerEnv()).toThrow(/FIREBASE_CLIENT_EMAIL/);
    expect(() => getServerEnv()).toThrow(/FIREBASE_PRIVATE_KEY/);
  });

  it("treats empty strings as missing for required variables", () => {
    stubAll({ ...SERVER_VALUES, FIREBASE_PROJECT_ID: "" });
    expect(() => getServerEnv()).toThrow(/FIREBASE_PROJECT_ID/);
  });

  it("converts literal \\n sequences in FIREBASE_PRIVATE_KEY to real newlines", () => {
    stubAll(SERVER_VALUES);
    const env = getServerEnv();
    expect(env.FIREBASE_PRIVATE_KEY).toBe("-----BEGIN KEY-----\nabc\n-----END KEY-----\n");
    expect(env.FIREBASE_PRIVATE_KEY).not.toContain("\\n");
  });

  it("defaults SESSION_COOKIE_MAX_DAYS to 5 and accepts 1-14", () => {
    stubAll(SERVER_VALUES);
    expect(getServerEnv().SESSION_COOKIE_MAX_DAYS).toBe(5);
    __resetEnvCacheForTests();
    vi.stubEnv("SESSION_COOKIE_MAX_DAYS", "14");
    expect(getServerEnv().SESSION_COOKIE_MAX_DAYS).toBe(14);
  });

  it.each(["0", "15", "2.5", "abc"])("rejects SESSION_COOKIE_MAX_DAYS=%s", (value) => {
    stubAll({ ...SERVER_VALUES, SESSION_COOKIE_MAX_DAYS: value });
    expect(() => getServerEnv()).toThrow(/SESSION_COOKIE_MAX_DAYS/);
  });

  it("memoizes the parsed result", () => {
    stubAll(SERVER_VALUES);
    expect(getServerEnv()).toBe(getServerEnv());
  });
});

describe("isConfigured", () => {
  it("cloudinary is false until all three variables exist, then true", () => {
    stubAll(SERVER_VALUES);
    expect(isConfigured("cloudinary")).toBe(false);

    __resetEnvCacheForTests();
    stubAll({ CLOUDINARY_CLOUD_NAME: "demo", CLOUDINARY_API_KEY: "key" });
    expect(isConfigured("cloudinary")).toBe(false);

    __resetEnvCacheForTests();
    vi.stubEnv("CLOUDINARY_API_SECRET", "secret");
    expect(isConfigured("cloudinary")).toBe(true);
  });

  it("treats empty strings as not configured", () => {
    stubAll({
      ...SERVER_VALUES,
      CLOUDINARY_CLOUD_NAME: "demo",
      CLOUDINARY_API_KEY: "key",
      CLOUDINARY_API_SECRET: "",
    });
    expect(isConfigured("cloudinary")).toBe(false);
  });

  it.each([
    [
      "whatsapp",
      [
        "WHATSAPP_PHONE_NUMBER_ID",
        "WHATSAPP_ACCESS_TOKEN",
        "WHATSAPP_VERIFY_TOKEN",
        "WHATSAPP_APP_SECRET",
      ],
    ],
    ["openai", ["OPENAI_API_KEY"]],
    ["twilio", ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"]],
    ["sslcommerz", ["SSLCOMMERZ_STORE_ID", "SSLCOMMERZ_STORE_PASSWORD"]],
    ["n8n", ["N8N_WEBHOOK_URL", "N8N_WEBHOOK_SECRET"]],
  ] as const)("%s requires all of its variables", (integration, keys) => {
    stubAll(SERVER_VALUES);
    expect(isConfigured(integration)).toBe(false);

    for (const key of keys.slice(0, -1)) vi.stubEnv(key, "https://x.example");
    __resetEnvCacheForTests();
    if (keys.length > 1) expect(isConfigured(integration)).toBe(false);

    vi.stubEnv(keys[keys.length - 1]!, "https://x.example");
    __resetEnvCacheForTests();
    expect(isConfigured(integration)).toBe(true);
  });
});

describe("isEmulator", () => {
  it("is true only when both emulator hosts are set", () => {
    expect(isEmulator()).toBe(false);
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8085");
    expect(isEmulator()).toBe(false);
    vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9199");
    expect(isEmulator()).toBe(true);
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", undefined);
    expect(isEmulator()).toBe(false);
  });

  it("is false in production even with both hosts set", () => {
    stubAll({
      NODE_ENV: "production",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8085",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9199",
    });
    expect(isEmulator()).toBe(false);
  });
});
