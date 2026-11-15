import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetClientEnvCacheForTests, getClientEnv } from "./env.client";

const CLIENT_VALUES = {
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_FIREBASE_API_KEY: "public-api-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-salespilot",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "demo.appspot.com",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "123456",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:123456:web:abc",
};

const SERVER_SECRETS = {
  FIREBASE_PROJECT_ID: "server-project-id-value",
  FIREBASE_CLIENT_EMAIL: "svc-secret@example.iam.gserviceaccount.com",
  FIREBASE_PRIVATE_KEY: "sk-secret-private-key",
  CRON_SECRET: "sk-secret-cron",
  ENCRYPTION_KEY: "sk-secret-encryption",
  CLOUDINARY_API_SECRET: "sk-secret-cloudinary",
  OPENAI_API_KEY: "sk-secret-openai",
};

function stubAll(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

beforeEach(() => {
  for (const key of [...Object.keys(CLIENT_VALUES), "NEXT_PUBLIC_USE_EMULATORS", "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL"]) {
    vi.stubEnv(key, undefined);
  }
  __resetClientEnvCacheForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetClientEnvCacheForTests();
});

describe("getClientEnv", () => {
  it("returns validated public variables with USE_EMULATORS defaulting to false", () => {
    stubAll(CLIENT_VALUES);
    const env = getClientEnv();
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    expect(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID).toBe("demo-salespilot");
    expect(env.NEXT_PUBLIC_USE_EMULATORS).toBe(false);
  });

  it("parses NEXT_PUBLIC_USE_EMULATORS=true", () => {
    stubAll({ ...CLIENT_VALUES, NEXT_PUBLIC_USE_EMULATORS: "true" });
    expect(getClientEnv().NEXT_PUBLIC_USE_EMULATORS).toBe(true);
  });

  it("defaults the browser Auth emulator URL to http://127.0.0.1:9199", () => {
    stubAll(CLIENT_VALUES);
    expect(getClientEnv().NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL).toBe("http://127.0.0.1:9199");
    __resetClientEnvCacheForTests();
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL", "");
    expect(getClientEnv().NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL).toBe("http://127.0.0.1:9199");
  });

  it("accepts NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL for an alternate emulator port", () => {
    stubAll({ ...CLIENT_VALUES, NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL: "http://localhost:9299" });
    expect(getClientEnv().NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL).toBe("http://localhost:9299");
  });

  it.each(["9299", "javascript:alert(1)", "ftp://127.0.0.1:9199"])(
    "rejects an invalid NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL (%s), naming only the variable",
    (bad) => {
      stubAll({ ...CLIENT_VALUES, NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL: bad });
      const message = messageOf(getClientEnv);
      expect(message).toContain("NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL");
      expect(message).not.toContain(bad);
    },
  );

  it("throws naming only the variable when a required public variable is missing", () => {
    stubAll(CLIENT_VALUES);
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", undefined);
    const message = messageOf(getClientEnv);
    expect(message).toContain("NEXT_PUBLIC_FIREBASE_API_KEY");
    expect(message).not.toContain("public-api-key");
    expect(message).not.toContain("demo-salespilot");
  });

  it("names invalid variables without echoing their values", () => {
    stubAll({ ...CLIENT_VALUES, NEXT_PUBLIC_APP_URL: "not-a-url" });
    const message = messageOf(getClientEnv);
    expect(message).toContain("NEXT_PUBLIC_APP_URL");
    expect(message).not.toContain("not-a-url");
  });

  it("memoizes the parsed result", () => {
    stubAll(CLIENT_VALUES);
    expect(getClientEnv()).toBe(getClientEnv());
  });

  it("exposes only NEXT_PUBLIC_ keys and no server secret names or values", () => {
    stubAll({ ...CLIENT_VALUES, ...SERVER_SECRETS });
    const env = getClientEnv();
    const serialized = JSON.stringify(env);
    expect(Object.keys(env).every((key) => key.startsWith("NEXT_PUBLIC_"))).toBe(true);
    for (const [name, value] of Object.entries(SERVER_SECRETS)) {
      expect(Object.keys(env)).not.toContain(name);
      expect(serialized).not.toContain(`"${name}"`);
      expect(serialized).not.toContain(value);
    }
  });
});
