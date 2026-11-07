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

import { assertOwnedPublicId } from "./folders";
import { confirmUpload, deleteAsset, signUpload } from "./index";
import { deleteUploadRecord, saveUploadRecord } from "./records";

// The Admin API and uploader are mocked (no network); signing stays real and is also verified
// against an independently computed SHA-1.
type SafeBool = { as_safe_bool: (value: unknown) => unknown };

vi.mock("cloudinary", async (importOriginal) => {
  const actual = await importOriginal<typeof import("cloudinary")>();
  const real = (actual.v2 ??
    (actual as unknown as { default: typeof actual }).default.v2) as typeof actual.v2;
  return {
    v2: {
      config: vi.fn(real.config),
      utils: {
        api_sign_request: vi.fn(real.utils.api_sign_request),
        as_safe_bool: (real.utils as unknown as SafeBool).as_safe_bool,
      },
      api: { resource: vi.fn() },
      uploader: { destroy: vi.fn() },
    },
  };
});
// Firestore is not available in unit tests: the record store is mocked.
vi.mock("./records", () => ({
  saveUploadRecord: vi.fn(async () => undefined),
  deleteUploadRecord: vi.fn(async () => undefined),
}));

const CLOUD = "demo-cloud";
const KEY = "key-123456789";
const SECRET = "secret-abcdefghijklmnop";
const ORG = "org-A";
const resource = vi.mocked(cloudinary.api.resource);
const destroy = vi.mocked(cloudinary.uploader.destroy);
const signSpy = vi.mocked(cloudinary.utils.api_sign_request);
const configSpy = vi.mocked(cloudinary.config);
const saveRecord = vi.mocked(saveUploadRecord);
const deleteRecord = vi.mocked(deleteUploadRecord);

function stubCloudinary(): void {
  vi.stubEnv("CLOUDINARY_CLOUD_NAME", CLOUD);
  vi.stubEnv("CLOUDINARY_API_KEY", KEY);
  vi.stubEnv("CLOUDINARY_API_SECRET", SECRET);
  __resetEnvCacheForTests();
}

let logged: string[] = [];
beforeEach(() => {
  vi.stubEnv("FIREBASE_PROJECT_ID", "demo-salespilot");
  vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8085");
  vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9199");
  stubCloudinary();
  resource.mockReset();
  destroy.mockReset();
  signSpy.mockClear();
  configSpy.mockClear();
  saveRecord.mockClear();
  deleteRecord.mockClear();
  logged = [];
  for (const level of ["error", "warn", "info"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
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

/** The error shape the real SDK rejects with (see cloudinary/lib/api_client/execute_request.js). */
function sdkError(httpCode: number, message = "Cloudinary says no") {
  return {
    request_options: {
      method: "GET",
      host: "api.cloudinary.com",
      path: `/v1_1/${CLOUD}/resources/image/upload/x`,
      auth: `${KEY}:${SECRET}`,
    },
    query_params: `api_key=${KEY}`,
    error: { message, http_code: httpCode },
  };
}

describe("signature algorithm reference", () => {
  it("the independent helper agrees with the SDK on a multi-param example", () => {
    const params = {
      eager: "w_400,h_300,c_pad|w_260,h_200,c_crop",
      public_id: "sample",
      timestamp: "1315060510",
    };
    expect(expectedSignature(params, "abcd")).toBe(
      cloudinary.utils.api_sign_request(params, "abcd"),
    );
    expect(expectedSignature(params, "abcd")).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("signUpload", () => {
  const file = { contentType: "image/png", bytes: 1000 };

  it("signs a server-generated public id with exactly the five constraints", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T00:00:00Z"));
    const out = signUpload(ORG, "products", file);
    expect(out.cloudName).toBe(CLOUD);
    expect(out.apiKey).toBe(KEY);
    expect(out.uploadUrl).toBe(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`);
    expect(out.maxBytes).toBe(5_242_880);
    expect(out.publicId).toMatch(/^organizations\/org-A\/products\/[a-f0-9]{24}$/);
    expect(out.params).toEqual({
      public_id: out.publicId,
      timestamp: String(Math.floor(Date.parse("2026-11-07T00:00:00Z") / 1000)),
      allowed_formats: "jpg,png,webp,avif",
      overwrite: "0",
      type: "upload",
    });
    expect(Object.keys(out.params).sort()).toEqual([
      "allowed_formats",
      "overwrite",
      "public_id",
      "timestamp",
      "type",
    ]);
    // No folder / unique_filename / use_filename: the id is fully determined by the server.
    expect(out.params).not.toHaveProperty("folder");
    expect(out.params).not.toHaveProperty("unique_filename");
    expect(out.params).not.toHaveProperty("use_filename");
  });

  it("serialises overwrite exactly as the SDK does for false", () => {
    const sdk = String((cloudinary.utils as unknown as SafeBool).as_safe_bool(false));
    expect(sdk).toBe("0");
    expect(signUpload(ORG, "products", file).params.overwrite).toBe(sdk);
  });

  it("generates a different public id on every call, under the right org and kind path", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(signUpload(ORG, "products", file).publicId);
    expect(ids.size).toBe(50);
    const other = signUpload("org-B", "customers", file).publicId;
    expect(other).toMatch(/^organizations\/org-B\/customers\/[a-f0-9]{24}$/);
    // Every generated id is accepted by the ownership check, and only for its own org.
    for (const id of ids) expect(assertOwnedPublicId(ORG, id)).toBe("products");
    expect(() => assertOwnedPublicId("org-B", [...ids][0]!)).toThrow(ForbiddenError);
  });

  it("the generated id satisfies the product image schema", () => {
    const { publicId } = signUpload(ORG, "products", file);
    const image = {
      url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${publicId}.jpg`,
      publicId,
      width: 10,
      height: 10,
    };
    expect(
      productInputSchema.safeParse({ name: "P", sku: "P1", regularPriceMinor: 1, images: [image] })
        .success,
    ).toBe(true);
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

  it("the signature differs between calls and between organizations", () => {
    const a = signUpload(ORG, "products", file);
    const b = signUpload("org-B", "products", file);
    const c = signUpload(ORG, "customers", file);
    expect(new Set([a.signature, b.signature, c.signature]).size).toBe(3);
  });

  it("serialises exactly as it is signed (all values are strings)", () => {
    const out = signUpload(ORG, "products", file);
    for (const value of Object.values(out.params)) expect(typeof value).toBe("string");
    const form: Record<string, string> = {};
    for (const [k, v] of Object.entries(out.params)) form[k] = String(v);
    expect(expectedSignature(form, SECRET)).toBe(out.signature);
  });

  it("never exposes the API secret", () => {
    expect(JSON.stringify(signUpload(ORG, "products", file))).not.toContain(SECRET);
  });

  it("configures the SDK lazily with hide_sensitive", () => {
    expect(configSpy).not.toHaveBeenCalled();
    signUpload(ORG, "products", file);
    expect(configSpy).toHaveBeenCalledWith(
      expect.objectContaining({ cloud_name: CLOUD, hide_sensitive: true, secure: true }),
    );
  });

  it.each(["image/jpeg", "image/png", "image/webp", "image/avif"])("accepts %s", (contentType) => {
    expect(() => signUpload(ORG, "customers", { contentType, bytes: 10 })).not.toThrow();
  });

  it.each([
    "image/svg+xml",
    "application/pdf",
    "image/gif",
    "text/html",
    "IMAGE/PNG",
    "image/png; charset=x",
    "",
  ])("rejects content type %j", (contentType) => {
    expect(() => signUpload(ORG, "products", { contentType, bytes: 10 })).toThrow(ValidationError);
  });

  it("accepts exactly 5 MB and 1 byte; rejects more, zero, negative, fractional and unsafe sizes", () => {
    expect(() =>
      signUpload(ORG, "products", { contentType: "image/png", bytes: 5_242_880 }),
    ).not.toThrow();
    expect(() => signUpload(ORG, "products", { contentType: "image/png", bytes: 1 })).not.toThrow();
    for (const bytes of [
      5_242_881,
      6 * 1024 * 1024,
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2 ** 60,
    ]) {
      expect(() => signUpload(ORG, "products", { contentType: "image/png", bytes })).toThrow(
        ValidationError,
      );
    }
  });

  it("rejects knowledge uploads", () => {
    expect(() =>
      signUpload(ORG, "knowledge", { contentType: "application/pdf", bytes: 10 }),
    ).toThrow("Knowledge uploads are not available yet");
  });

  it("throws IntegrationNotConfiguredError without signing when credentials are missing", () => {
    vi.stubEnv("CLOUDINARY_API_SECRET", "");
    __resetEnvCacheForTests();
    expect(() => signUpload(ORG, "products", file)).toThrow(IntegrationNotConfiguredError);
    expect(signSpy).not.toHaveBeenCalled();
  });
});

const OWN = `organizations/${ORG}/products/0123456789abcdef01234567`;

function asset(over: Record<string, unknown> = {}) {
  return {
    public_id: OWN,
    resource_type: "image",
    type: "upload",
    format: "jpg",
    bytes: 1234,
    width: 800,
    height: 600,
    version: 1700000000,
    secure_url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1700000000/${OWN}.jpg`,
    ...over,
  };
}

describe("confirmUpload", () => {
  it("returns the stored image shape and records the confirmation", async () => {
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
    expect(saveRecord).toHaveBeenCalledWith({
      organizationId: ORG,
      kind: "products",
      publicId: OWN,
      url: image.url,
      width: 800,
      height: 600,
      bytes: 1234,
    });
    expect(
      productInputSchema.safeParse({
        name: "P",
        sku: "P1",
        regularPriceMinor: 100,
        images: [image],
      }).success,
    ).toBe(true);
    expect(JSON.stringify(image)).not.toContain(SECRET);
  });

  it("accepts an asset of exactly 5 MB", async () => {
    resource.mockResolvedValue(asset({ bytes: 5_242_880 }));
    await expect(confirmUpload(ORG, "products", OWN)).resolves.toBeDefined();
  });

  it("forbids another organization's id without calling Cloudinary or recording", async () => {
    await expect(
      confirmUpload("orgA", "products", "organizations/orgB/products/0123456789abcdef01234567"),
    ).rejects.toThrow(ForbiddenError);
    expect(resource).not.toHaveBeenCalled();
    expect(saveRecord).not.toHaveBeenCalled();
  });

  it.each([
    "organizations/orgAB/products/0123456789abcdef01234567",
    "organizations/orgA/products/../../orgB/0123456789abcdef01234567",
    "organizations/orgA/products/%2e%2e/0123456789abcdef01234567",
    "organizations/orgA/products/0123456789abcdef01234567.jpg",
    "organizations/orgA/products//0123456789abcdef01234567",
    "organizations/orgA/products/x",
  ])("forbids %j", async (id) => {
    await expect(confirmUpload("orgA", "products", id)).rejects.toThrow(ForbiddenError);
    expect(resource).not.toHaveBeenCalled();
  });

  it("forbids a kind mismatch (id under customers, kind products)", async () => {
    await expect(
      confirmUpload(ORG, "products", `organizations/${ORG}/customers/0123456789abcdef01234567`),
    ).rejects.toThrow(ForbiddenError);
    expect(resource).not.toHaveBeenCalled();
  });

  it("rejects knowledge", async () => {
    await expect(
      confirmUpload(ORG, "knowledge", `organizations/${ORG}/knowledge/0123456789abcdef01234567`),
    ).rejects.toThrow(ValidationError);
    expect(resource).not.toHaveBeenCalled();
  });

  it("maps a Cloudinary 404 to NotFoundError (flat and the SDK's nested error shape)", async () => {
    resource.mockRejectedValueOnce({ message: "Resource not found - x", http_code: 404 });
    await expect(confirmUpload(ORG, "products", OWN)).rejects.toThrow(NotFoundError);
    resource.mockRejectedValueOnce(sdkError(404, "Resource not found - x"));
    const err = (await confirmUpload(ORG, "products", OWN).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(NotFoundError);
    for (const text of [err.message, JSON.stringify(err), logged.join("\n")]) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(SECRET);
    }
    expect(saveRecord).not.toHaveBeenCalled();
  });

  it("destroys and rejects an oversize asset, recording nothing", async () => {
    resource.mockResolvedValue(asset({ bytes: 5_242_881 }));
    destroy.mockResolvedValue({ result: "ok" });
    await expect(confirmUpload(ORG, "products", OWN)).rejects.toThrow(ValidationError);
    expect(destroy).toHaveBeenCalledWith(OWN, { resource_type: "image", invalidate: true });
    expect(saveRecord).not.toHaveBeenCalled();
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
  ])("destroys and rejects (400) on %s", async (_name, over) => {
    resource.mockResolvedValue(asset(over));
    destroy.mockResolvedValue({ result: "ok" });
    await expect(confirmUpload(ORG, "products", OWN)).rejects.toThrow(ValidationError);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(saveRecord).not.toHaveBeenCalled();
  });

  it.each([
    ["foreign cloud", { secure_url: `https://res.cloudinary.com/evil/image/upload/v1/${OWN}.jpg` }],
    [
      "foreign host",
      { secure_url: `https://evil.example.com/${CLOUD}/image/upload/v1/${OWN}.jpg` },
    ],
    ["http url", { secure_url: `http://res.cloudinary.com/${CLOUD}/image/upload/v1/${OWN}.jpg` }],
    [
      "url for a different asset",
      { secure_url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1/other.jpg` },
    ],
    ["no url", { secure_url: undefined }],
    ["public id mismatch", { public_id: `organizations/${ORG}/products/ffffffffffffffffffffffff` }],
  ])("is a generic 500 and does NOT destroy on %s (deployment mismatch)", async (_name, over) => {
    resource.mockResolvedValue(asset(over));
    const err = (await confirmUpload(ORG, "products", OWN).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ValidationError);
    expect((err as { status?: number }).status).toBeUndefined();
    expect(err.message).toBe("Cloudinary request failed");
    expect(destroy).not.toHaveBeenCalled();
    expect(saveRecord).not.toHaveBeenCalled();
    expect(logged.join("\n")).toContain("cloudinary_asset_unexpected");
  });

  it("still rejects when the best-effort destroy fails, logging no secrets", async () => {
    resource.mockResolvedValue(asset({ format: "svg" }));
    destroy.mockRejectedValue(sdkError(500, `bad ${KEY} ${SECRET}`));
    await expect(confirmUpload(ORG, "products", OWN)).rejects.toThrow(ValidationError);
    const text = logged.join("\n");
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(SECRET);
  });

  it("turns other Cloudinary errors (real nested shape with auth) into a generic error; code-only logging", async () => {
    resource.mockRejectedValue(
      sdkError(
        401,
        `Invalid signature for https://api.cloudinary.com/?api_key=${KEY}&signature=deadbeef ${SECRET}`,
      ),
    );
    const err = (await confirmUpload(ORG, "products", OWN).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect((err as { status?: number }).status).toBeUndefined();
    expect(err.message).toBe("Cloudinary request failed");
    const everything = [err.message, JSON.stringify(err), logged.join("\n")].join("\n");
    for (const needle of [KEY, SECRET, "deadbeef"]) expect(everything).not.toContain(needle);
    expect(logged.join("\n")).toContain("401");
    expect(saveRecord).not.toHaveBeenCalled();
  });

  it("throws IntegrationNotConfiguredError without calling the SDK when unconfigured", async () => {
    vi.stubEnv("CLOUDINARY_API_KEY", "");
    __resetEnvCacheForTests();
    await expect(confirmUpload(ORG, "products", OWN)).rejects.toThrow(
      IntegrationNotConfiguredError,
    );
    expect(resource).not.toHaveBeenCalled();
  });
});

describe("deleteAsset", () => {
  it("destroys an owned asset with invalidation and removes its record first", async () => {
    destroy.mockResolvedValue({ result: "ok" });
    await expect(deleteAsset(ORG, OWN)).resolves.toBeUndefined();
    expect(destroy).toHaveBeenCalledWith(OWN, { resource_type: "image", invalidate: true });
    expect(deleteRecord).toHaveBeenCalledWith(OWN);
    expect(deleteRecord.mock.invocationCallOrder[0]!).toBeLessThan(
      destroy.mock.invocationCallOrder[0]!,
    );
  });

  it("is idempotent when the asset is already gone", async () => {
    destroy.mockResolvedValue({ result: "not found" });
    await expect(deleteAsset(ORG, OWN)).resolves.toBeUndefined();
    destroy.mockRejectedValue(sdkError(404));
    await expect(deleteAsset(ORG, OWN)).resolves.toBeUndefined();
  });

  it("forbids foreign ids without calling Cloudinary or touching records", async () => {
    await expect(
      deleteAsset(ORG, "organizations/other/products/0123456789abcdef01234567"),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      deleteAsset(ORG, "organizations/org-AB/products/0123456789abcdef01234567"),
    ).rejects.toThrow(ForbiddenError);
    expect(destroy).not.toHaveBeenCalled();
    expect(deleteRecord).not.toHaveBeenCalled();
  });

  it("fails generically on any other result or error, without leaks", async () => {
    destroy.mockResolvedValue({ result: "error" });
    await expect(deleteAsset(ORG, OWN)).rejects.toThrow("Cloudinary request failed");
    destroy.mockRejectedValue(sdkError(500, SECRET));
    const err = (await deleteAsset(ORG, OWN).catch((e: unknown) => e)) as Error;
    const everything = [err.message, logged.join("\n")].join("\n");
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain(KEY);
  });

  it("throws IntegrationNotConfiguredError when unconfigured", async () => {
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "");
    __resetEnvCacheForTests();
    await expect(deleteAsset(ORG, OWN)).rejects.toThrow(IntegrationNotConfiguredError);
    expect(destroy).not.toHaveBeenCalled();
    expect(deleteRecord).not.toHaveBeenCalled();
  });
});
