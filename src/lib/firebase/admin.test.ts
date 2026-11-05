import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appMocks = vi.hoisted(() => ({
  cert: vi.fn((value: unknown) => ({ __cert: value })),
  getApp: vi.fn(),
  getApps: vi.fn(() => [] as { name: string }[]),
  initializeApp: vi.fn((options: unknown) => ({ name: "[DEFAULT]", options })),
}));

vi.mock("firebase-admin/app", () => appMocks);
vi.mock("firebase-admin/auth", () => ({ getAuth: vi.fn(() => ({})) }));
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => ({})),
  initializeFirestore: vi.fn(() => ({})),
}));

import { __resetEnvCacheForTests } from "@/config/env";

import { adminAuth } from "./admin";

const KEYS = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_AUTH_EMULATOR_HOST",
  "NODE_ENV",
];

beforeEach(() => {
  for (const key of KEYS) vi.stubEnv(key, undefined);
  vi.stubEnv("FIREBASE_PROJECT_ID", "demo-salespilot");
  __resetEnvCacheForTests();
  vi.clearAllMocks();
  appMocks.getApps.mockReturnValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetEnvCacheForTests();
});

describe("admin credentials", () => {
  it("requires service-account credentials outside the emulator", () => {
    expect(() => adminAuth()).toThrow(/FIREBASE_CLIENT_EMAIL/);
    expect(appMocks.initializeApp).not.toHaveBeenCalled();
  });

  it("uses an explicit cert() credential outside the emulator", () => {
    vi.stubEnv("FIREBASE_CLIENT_EMAIL", "svc@demo-salespilot.iam.gserviceaccount.com");
    vi.stubEnv("FIREBASE_PRIVATE_KEY", "key\nbody");
    adminAuth();
    expect(appMocks.cert).toHaveBeenCalledWith({
      projectId: "demo-salespilot",
      clientEmail: "svc@demo-salespilot.iam.gserviceaccount.com",
      privateKey: "key\nbody",
    });
    expect(appMocks.initializeApp).toHaveBeenCalledTimes(1);
  });

  it("initialises with the project id only when both emulator hosts are set", () => {
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8085");
    vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9199");
    adminAuth();
    expect(appMocks.cert).not.toHaveBeenCalled();
    expect(appMocks.initializeApp).toHaveBeenCalledWith({ projectId: "demo-salespilot" });
  });

  it("fails closed when only one emulator host is set", () => {
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8085");
    expect(() => adminAuth()).toThrow(/FIREBASE_AUTH_EMULATOR_HOST/);
    expect(appMocks.initializeApp).not.toHaveBeenCalled();
  });

  it("does not initialise the default app twice", () => {
    appMocks.getApps.mockReturnValue([{ name: "[DEFAULT]" }]);
    adminAuth();
    expect(appMocks.initializeApp).not.toHaveBeenCalled();
    expect(appMocks.getApp).toHaveBeenCalled();
  });

  it("never uses application-default credentials", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "admin.ts"), "utf8");
    expect(source).not.toMatch(/applicationDefault|GOOGLE_APPLICATION_CREDENTIALS/);
  });
});
