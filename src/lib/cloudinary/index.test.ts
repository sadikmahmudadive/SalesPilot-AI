import { createHash } from "node:crypto";

import { v2 as cloudinary } from "cloudinary";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetEnvCacheForTests } from "@/config/env";
import {
  ForbiddenError,
  IntegrationNotConfiguredError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { productInputSchema } from "@/schemas/product";

import { confirmUpload, deleteAsset, signUpload } from "./index";

// The Admin API and uploader are mocked (no network); signing stays real and is also verified
// against an independently computed SHA-1.
vi.mock("cloudinary", async (importOriginal) => {
  const actual = await importOriginal<typeof import("cloudinary")>();
  const real = (actual.v2 ?? (actual as unknown as { default: typeof actual }).default.v2) as typeof actual.v2;
  return {
    v2: {
      config: real.config,
      utils: { api_sign_request: vi.fn(real.utils.api_sign_request) },
      api: { resource: vi.fn() },
      uploader: { destroy: vi.fn() },
    },
  };
});

const CLOUD = "demo-cloud";
const KEY = "key-123456789";
const SECRET = "secret-abcdefghijklmnop";
const ORG = "org-A";
const resource = vi.mocked(cloudinary.api.resource);
const destroy = vi.mocked(cloudinary.uploader.destroy);
const signSpy = vi.mocked(cloudinary.utils.api_sign_request);

function stubCloudinary(): void {
  vi.stubEnv("CLOUDINARY_CLOUD_NAME", CLOUD);
  vi.stubEnv("CLOUDINARY_API_KEY", KEY);
  vi.stubEnv("CLOUDINARY_API_SECRET", SECRET);
  __resetEnvCacheForTests();
}

beforeEach(() => {
  vi.stubEnv("FIREBASE_PROJECT_ID", "demo-salespilot");
  vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8085");
  vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9199");
  stubCloudinary();
  resource.mockReset();
  destroy.mockReset();
  signSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetEnvCacheForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Cloudinary's documented algorithm: sorted `k=v` joined by `&`, secret appended, SHA-1 hex. */
function expectedSignature(params: Record<string, string>, secret: string): string {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1")
    .update(toSign + secret)
    .digest("hex");
}

describe("signature algorithm reference", () => {
  it("the independent helper agrees with the SDK on a multi-param example", () => {
    const params = { eager: "w_400,h_300,c_pad|w_260,h_200,c_crop", public_id: "sample", timestamp: "1315060510" };
    expect(expectedSignature(params, "abcd")).toBe(cloudinary.utils.api_sign_request(params, "abcd"));
    expect(expectedSignature(params, "abcd")).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("signUpload", () => {
  const file = { contentType: "image/png", bytes: 1000 };

  it("signs the org folder with every upload constraint", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T00:00:00Z"));
    const out = signUpload(ORG, "products", file);
    expect(out.cloudName).toBe(CLOUD);
    expect(out.apiKey).toBe(KEY);
    expect(out.uploadUrl).toBe(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`);
    expect(out.maxBytes).toBe(5_242_880);
    expect(out.params).toEqual({
      folder: "organizations/org-A/products",
      timestamp: String(Math.floor(Date.parse("2026-11-07T00:00:00Z") / 1000)),
      allowed_formats: "jpg,png,webp,avif",
      overwrite: "false",
      unique_filename: "true",
      use_filename: "false",
      type: "upload",
    });
    expect(Object.keys(out.params)).not.toContain("public_id");
  });

  it("signature equals the independently computed SHA-1 of every param", () => {
    const out = signUpload(ORG, "products", file);
    expect(out.signature).toBe(expectedSignature(out.params, SECRET));
    expect(out.signature).toMatch(/^[0-9a-f]{40}$/);
  });

  it("covers every param: dropping or changing any one changes the signature", () => {
    const out = signUpload(ORG, "products", file);
    for (const key of Object.keys(out.params)) {
      const without = { ...out.params } as Record<string, string>;
      delete without[key];
      expect(expectedSignature(without, SECRET)).not.toBe(out.signature);
      const changed = { ...out.params, [key]: `${(out.params as Record<string, string>)[key]}x` };
      expect(expectedSignature(changed, SECRET)).not.toBe(out.signature);
    }
    // And the SDK was asked to sign exactly the params that are returned.
    expect(signSpy).toHaveBeenCalledTimes(1);
    expect(signSpy.mock.calls[0]?.[0]).toEqual(out.params);
  });

  it("changes when the folder (organization or kind) changes", () => {
    const a = signUpload(ORG, "products", file);
    const b = signUpload("org-B", "products", file);
    const c = signUpload(ORG, "customers", file);
    expect(a.params.folder).not.toBe(b.params.folder);
    expect(new Set([a.signature, b.signature, c.signature]).size).toBe(3);
  });

  it("serialises exactly as it is signed (all values are strings)", () => {
    const out = signUpload(ORG, "products", file);
    for (const value of Object.values(out.params)) expect(typeof value).toBe("string");
    // What a browser FormData would carry is String(value) of the same strings.
    const form: Record<string, string> = {};
    for (const [k, v] of Object.entries(out.params)) form[k] = String(v);
    expect(expectedSignature(form, SECRET)).toBe(out.signature);
  });

  it("never exposes the API secret", () => {
    expect(JSON.stringify(signUpload(ORG, "products", file))).not.toContain(SECRET);
  });

  it.each(["image/jpeg", "image/png", "image/webp", "image/avif"])("accepts %s", (contentType) => {
    expect(() => signUpload(ORG, "customers", { contentType, bytes: 10 })).not.toThrow();
  });

  it.each(["image/svg+xml", "application/pdf", "image/gif", "text/html", "IMAGE/PNG", "image/png; charset=x", ""])(
    "rejects content type %j",
    (contentType) => {
      expect(() => signUpload(ORG, "products", { contentType, bytes: 10 })).toThrow(ValidationError);
    },
  );

  it("accepts exactly 5 MB and 1 byte; rejects more, zero, negative, fractional and unsafe sizes", () => {
    expect(() => signUpload(ORG, "products", { contentType: "image/png", bytes: 5_242_880 })).not.toThrow();
    expect(() => signUpload(ORG, "products", { contentType: "image/png", bytes: 1 })).not.toThrow();
    for (const bytes of [5_242_881, 6 * 1024 * 1024, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) {
      expect(() => signUpload(ORG, "products", { contentType: "image/png", bytes })).toThrow(ValidationError);
    }
  });

  it("rejects knowledge uploads", () => {
    expect(() => signUpload(ORG, "knowledge", { contentType: "application/pdf", bytes: 10 })).toThrow(
      "Knowledge uploads are not available yet",
    );
  });

  it("throws IntegrationNotConfiguredError without signing when credentials are missing", () => {
    vi.stubEnv("CLOUDINARY_API_SECRET", "");
    __resetEnvCacheForTests();
    expect(() => signUpload(ORG, "products", file)).toThrow(IntegrationNotConfiguredError);
    expect(signSpy).not.toHaveBeenCalled();
  });
});

function asset(over: Record<string, unknown> = {}) {
  return {
    public_id: `organizations/${ORG}/products/abc123`,
    resource_type: "image",
    type: "upload",
    format: "jpg",
    bytes: 1234,
    width: 800,
    height: 600,
    version: 1700000000,
    secure_url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1700000000/organizations/${ORG}/products/abc123.jpg`,
    ...over,
  };
}
const OWN = `organizations/${ORG}/products/abc123`;

describe("confirmUpload", () => {
  it("returns the stored image shape, which satisfies the product schema", async () => {
    resource.mockResolvedValue(asset());
    const image = await confirmUpload(ORG, "products", OWN);
    expect(image).toEqual({
      url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1700000000/${OWN}.jpg`,
      publicId: OWN,
      width: 800,
      height: 600,
    });
    expect(resource).toHaveBeenCalledWith(OWN, { resource_type: "image" });
    expect(destroy).not.toHaveBeenCalled();
    expect(
      productInputSchema.safeParse({ name: "P", sku: "P1", regularPriceMinor: 100, images: [image] }).success,
    ).toBe(true);
    expect(JSON.stringify(image)).not.toContain(SECRET);
  });

  it("accepts an asset of exactly 5 MB", async () => {
    resource.mockResolvedValue(asset({ bytes: 5_242_880 }));
    await expect(confirmUpload(ORG, "products", OWN)).resolves.toBeDefined();
  });

  it("forbids another organization's id without calling Cloudinary", async () => {
    await expect(confirmUpload("orgA", "products", "organizations/orgB/products/x")).rejects.toThrow(ForbiddenError);
    expect(resource).not.toHaveBeenCalled();
  });

  it.each([
    "organizations/AB/products/x",
    "organizations/orgA/products/../../orgB/x",
    "organizations/orgA/products/%2e%2e/x",
    "organizations/orgA/products/a\\b",
    "organizations/orgA/products//x",
    "organizations/orgA/products/a\x01b",
  ])("forbids %j", async (id) => {
    await expect(confirmUpload("orgA", "products", id)).rejects.toThrow(ForbiddenError);
    expect(resource).not.toHaveBeenCalled();
  });

  it("forbids a kind mismatch (id under customers, kind products)", async () => {
    await expect(confirmUpload(ORG, "products", `organizations/${ORG}/customers/x`)).rejects.toThrow(ForbiddenError);
    expect(resource).not.toHaveBeenCalled();
  });

  it("rejects knowledge", async () => {
    await expect(confirmUpload(ORG, "knowledge", `organizations/${ORG}/knowledge/x`)).rejects.toThrow(ValidationError);
    expect(resource).not.toHaveBeenCalled();
  });

  it("maps a Cloudinary 404 to NotFoundError", async () => {
    resource.mockRejectedValue({ message: "Resource not found - x", http_code: 404 });
    await expect(confirmUpload(ORG, "products", OWN)).rejects.toThrow(NotFoundError);
  });

  it("destroys and rejects an oversize asset", async () => {
    resource.mockResolvedValue(asset({ bytes: 5_242_881 }));
    destroy.mockResolvedValue({ result: "ok" });
    await expect(confirmUpload(ORG, "products", OWN)).rejects.toThrow(ValidationError);
    expect(destroy).toHaveBeenCalledWith(OWN, { resource_type: "image", invalidate: true });
  });

  it.each([
    ["format", { format: "svg" }],
    ["format pdf", { format: "pdf" }],
    ["resource type", { resource_type: "raw" }],
    ["bytes missing", { bytes: undefined }],
    ["bytes zero", { bytes: 0 }],
    ["width zero", { width: 0 }],
    ["height fractional", { height: 1.5 }],
    ["width missing", { width: undefined }],
    ["public id mismatch", { public_id: `organizations/${ORG}/products/other` }],
    ["foreign cloud", { secure_url: "https://res.cloudinary.com/evil/image/upload/v1/x.jpg" }],
    ["foreign host", { secure_url: `https://evil.example.com/${CLOUD}/image/upload/v1/${OWN}.jpg` }],
    ["http url", { secure_url: `http://res.cloudinary.com/${CLOUD}/image/upload/v1/${OWN}.jpg` }],
    ["url for a different asset", { secure_url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1/other.jpg` }],
    ["no url", { secure_url: undefined }],
  ])("destroys and rejects on %s", async (_name, over) => {
    resource.mockResolvedValue(asset(over));
    destroy.mockResolvedValue({ result: "ok" });
    await expect(confirmUpload(ORG, "products", OWN)).rejects.toThrow(ValidationError);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("still rejects when the best-effort destroy fails, logging no secrets", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    resource.mockResolvedValue(asset({ format: "svg" }));
    destroy.mockRejectedValue({ message: `bad ${KEY} ${SECRET}`, http_code: 500 });
    await expect(confirmUpload(ORG, "products", OWN)).rejects.toThrow(ValidationError);
    const logged = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain(SECRET);
  });

  it("turns other Cloudinary errors into a generic error and logs only the code", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    resource.mockRejectedValue({
      message: `Invalid signature for https://api.cloudinary.com/?api_key=${KEY}&signature=deadbeef ${SECRET}`,
      http_code: 401,
    });
    const err = (await confirmUpload(ORG, "products", OWN).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect((err as { status?: number }).status).toBeUndefined();
    expect(err.message).not.toContain(KEY);
    expect(err.message).not.toContain(SECRET);
    const logged = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain("deadbeef");
    expect(logged).toContain("401");
  });

  it("throws IntegrationNotConfiguredError without calling the SDK when unconfigured", async () => {
    vi.stubEnv("CLOUDINARY_API_KEY", "");
    __resetEnvCacheForTests();
    await expect(confirmUpload(ORG, "products", OWN)).rejects.toThrow(IntegrationNotConfiguredError);
    expect(resource).not.toHaveBeenCalled();
  });
});

describe("deleteAsset", () => {
  it("destroys an owned asset with invalidation", async () => {
    destroy.mockResolvedValue({ result: "ok" });
    await expect(deleteAsset(ORG, OWN)).resolves.toBeUndefined();
    expect(destroy).toHaveBeenCalledWith(OWN, { resource_type: "image", invalidate: true });
  });

  it("is idempotent when the asset is already gone", async () => {
    destroy.mockResolvedValue({ result: "not found" });
    await expect(deleteAsset(ORG, OWN)).resolves.toBeUndefined();
  });

  it("forbids foreign ids without calling Cloudinary", async () => {
    await expect(deleteAsset(ORG, "organizations/other/products/x")).rejects.toThrow(ForbiddenError);
    await expect(deleteAsset(ORG, "organizations/org-AB/products/x")).rejects.toThrow(ForbiddenError);
    expect(destroy).not.toHaveBeenCalled();
  });

  it("fails generically on any other result or error", async () => {
    destroy.mockResolvedValue({ result: "error" });
    await expect(deleteAsset(ORG, OWN)).rejects.toThrow("Cloudinary request failed");
    destroy.mockRejectedValue({ message: SECRET, http_code: 500 });
    const err = (await deleteAsset(ORG, OWN).catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain(SECRET);
  });

  it("throws IntegrationNotConfiguredError when unconfigured", async () => {
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "");
    __resetEnvCacheForTests();
    await expect(deleteAsset(ORG, OWN)).rejects.toThrow(IntegrationNotConfiguredError);
    expect(destroy).not.toHaveBeenCalled();
  });
});
