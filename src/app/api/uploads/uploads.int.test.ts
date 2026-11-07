import { createHash, randomBytes, randomUUID } from "node:crypto";

import { v2 as cloudinary } from "cloudinary";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetEnvCacheForTests } from "@/config/env";
import { CONFIRM_QUOTA, assertConfirmQuota } from "@/lib/cloudinary/quota";
import { uploadRecordRef } from "@/lib/cloudinary/records";
import { RateLimitedError, UnauthenticatedError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/security/permissions";

import { POST as CONFIRM } from "./confirm/route";
import { POST as DELETE } from "./delete/route";
import { POST as SIGN } from "./sign/route";

let session: { uid: string; email: string | null } | null = null;
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => {
    if (!session) throw new UnauthenticatedError();
    return session;
  }),
}));

// Admin API and uploader are mocked (nothing is sent to Cloudinary); signing stays real.
vi.mock("cloudinary", async (importOriginal) => {
  const actual = await importOriginal<typeof import("cloudinary")>();
  const real = (actual.v2 ?? (actual as unknown as { default: typeof actual }).default.v2) as typeof actual.v2;
  return {
    v2: {
      config: vi.fn(real.config),
      utils: { api_sign_request: vi.fn(real.utils.api_sign_request) },
      api: { resource: vi.fn() },
      uploader: { destroy: vi.fn() },
    },
  };
});

const CLOUD = "demo-cloud";
const KEY = "key-123456789";
const SECRET = "secret-abcdefghijklmnop";
const resource = vi.mocked(cloudinary.api.resource);
const destroy = vi.mocked(cloudinary.uploader.destroy);
const signSpy = vi.mocked(cloudinary.utils.api_sign_request);

/** A generated-form public id (what sign returns): organizations/{org}/{kind}/{24 hex}. */
const pid = (org: string, kind = "products") => `organizations/${org}/${kind}/${randomBytes(12).toString("hex")}`;
/** The error shape the real SDK rejects with (cloudinary/lib/api_client/execute_request.js). */
const sdkError = (httpCode: number, message = "Cloudinary says no") => ({
  request_options: { method: "GET", host: "api.cloudinary.com", auth: `${KEY}:${SECRET}` },
  query_params: `api_key=${KEY}`,
  error: { message, http_code: httpCode },
});

const orgs = new Set<string>();
const uids: string[] = [];

async function seed(role: Role, organizationId = `org-${randomUUID()}`) {
  const uid = `uid-${randomUUID()}`;
  const db = adminDb();
  await db
    .collection("users")
    .doc(uid)
    .set({ uid, email: `${uid}@x.com`, defaultOrganizationId: organizationId });
  await db.collection("organizationMembers").doc(`${organizationId}_${uid}`).set({ organizationId, uid, role });
  orgs.add(organizationId);
  uids.push(uid);
  return { uid, organizationId };
}
const signIn = (uid: string) => {
  session = { uid, email: `${uid}@x.com` };
};

function send(url: string, body?: unknown, headers: Record<string, string> = {}): Request {
  const raw = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  const h = new Headers(body === undefined ? {} : { "content-type": "application/json" });
  for (const [k, v] of Object.entries(headers)) h.set(k, v);
  if (raw !== undefined) h.set("content-length", String(Buffer.byteLength(raw)));
  return new Request(url, { method: "POST", headers: h, body: raw });
}
const BASE = "http://localhost/api/uploads";
const sign = (body: unknown, headers?: Record<string, string>) => SIGN(send(`${BASE}/sign`, body, headers));
const confirm = (body: unknown, headers?: Record<string, string>) => CONFIRM(send(`${BASE}/confirm`, body, headers));
const del = (body: unknown, headers?: Record<string, string>) => DELETE(send(`${BASE}/delete`, body, headers));

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as Json;

function expectedSignature(params: Record<string, string>): string {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1")
    .update(toSign + SECRET)
    .digest("hex");
}

function stubCloudinary(on = true): void {
  vi.stubEnv("CLOUDINARY_CLOUD_NAME", on ? CLOUD : "");
  vi.stubEnv("CLOUDINARY_API_KEY", on ? KEY : "");
  vi.stubEnv("CLOUDINARY_API_SECRET", on ? SECRET : "");
  __resetEnvCacheForTests();
}

function asset(publicId: string, over: Record<string, unknown> = {}) {
  return {
    public_id: publicId,
    resource_type: "image",
    type: "upload",
    format: "png",
    bytes: 2000,
    width: 400,
    height: 300,
    secure_url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1700000000/${publicId}.png`,
    ...over,
  };
}

let logged: string[] = [];
beforeEach(() => {
  session = null;
  stubCloudinary();
  resource.mockReset();
  destroy.mockReset();
  signSpy.mockClear();
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
});

afterAll(async () => {
  const db = adminDb();
  for (const org of orgs) {
    const snap = await db.collection("uploads").where("organizationId", "==", org).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await Promise.all(
    uids.flatMap((u) => [
      db.collection("users").doc(u).delete(),
      ...[...orgs].map((o) => db.collection("organizationMembers").doc(`${o}_${u}`).delete()),
    ]),
  );
});

const signBody = { kind: "products", contentType: "image/png", bytes: 1000 };

describe("authentication, CSRF and content type", () => {
  it("401 without a session on all three routes", async () => {
    expect((await sign(signBody)).status).toBe(401);
    expect((await confirm({ kind: "products", publicId: "organizations/o/products/x" })).status).toBe(401);
    expect((await del({ publicId: "organizations/o/products/x" })).status).toBe(401);
  });

  it("403 for a user with no membership", async () => {
    signIn(`uid-${randomUUID()}`);
    expect((await sign(signBody)).status).toBe(403);
  });

  it("403 for a cross-origin request and 415 for text/plain", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    expect((await sign(signBody, { origin: "https://evil.example" })).status).toBe(403);
    expect((await sign(JSON.stringify(signBody), { "content-type": "text/plain" })).status).toBe(415);
    expect(signSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/uploads/sign", () => {
  it("signs a server-generated public id in the member's org folder and ignores client folder / public_id", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    const res = await sign({
      ...signBody,
      folder: "organizations/other/products",
      public_id: "organizations/other/products/steal",
      overwrite: true,
      unique_filename: false,
      organizationId: "other",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const out = await json(res);
    expect(out.publicId).toMatch(new RegExp(`^organizations/${a.organizationId}/products/[a-f0-9]{24}$`));
    expect(out.params).toEqual({
      public_id: out.publicId,
      timestamp: expect.stringMatching(/^\d{10}$/),
      allowed_formats: "jpg,png,webp,avif",
      overwrite: "0",
      type: "upload",
    });
    expect(out.cloudName).toBe(CLOUD);
    expect(out.apiKey).toBe(KEY);
    expect(out.uploadUrl).toBe(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`);
    expect(out.maxBytes).toBe(5_242_880);
    // Independent SHA-1 over exactly the posted params.
    expect(out.signature).toBe(expectedSignature(out.params));
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  it("two sign calls return different public ids under the right org and kind path", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    const first = await json(await sign(signBody));
    const second = await json(await sign(signBody));
    const customers = await json(await sign({ ...signBody, kind: "customers" }));
    expect(first.publicId).not.toBe(second.publicId);
    expect(first.signature).not.toBe(second.signature);
    expect(first.publicId.startsWith(`organizations/${a.organizationId}/products/`)).toBe(true);
    expect(customers.publicId.startsWith(`organizations/${a.organizationId}/customers/`)).toBe(true);
  });

  it("signature changes when the organization changes", async () => {
    const a = await seed("owner");
    const b = await seed("owner");
    signIn(a.uid);
    const first = await json(await sign(signBody));
    signIn(b.uid);
    const second = await json(await sign(signBody));
    expect(first.params.public_id).not.toBe(second.params.public_id);
    expect(first.signature).not.toBe(second.signature);
    expect(second.publicId.startsWith(`organizations/${b.organizationId}/`)).toBe(true);
  });

  it.each([
    ["svg", { ...signBody, contentType: "image/svg+xml" }],
    ["pdf", { ...signBody, contentType: "application/pdf" }],
    ["6 MB", { ...signBody, bytes: 6 * 1024 * 1024 }],
    ["zero bytes", { ...signBody, bytes: 0 }],
    ["negative bytes", { ...signBody, bytes: -5 }],
    ["fractional bytes", { ...signBody, bytes: 10.5 }],
    ["string bytes", { ...signBody, bytes: "10" }],
    ["unknown kind", { ...signBody, kind: "secrets" }],
    ["knowledge", { ...signBody, kind: "knowledge" }],
    ["missing type", { kind: "products", bytes: 10 }],
  ])("400 for %s", async (_name, body) => {
    const a = await seed("owner");
    signIn(a.uid);
    const res = await sign(body);
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe("VALIDATION_ERROR");
  });

  it("accepts exactly 5 MB", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    expect((await sign({ ...signBody, bytes: 5_242_880 })).status).toBe(200);
  });

  it("knowledge says it is not available yet", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    const res = await sign({ ...signBody, kind: "knowledge" });
    expect(JSON.stringify(await json(res))).toContain("Knowledge uploads are not available yet");
  });

  it("viewer 403; agent 403 for products but 200 for customers; admin may sign campaigns", async () => {
    const viewer = await seed("viewer");
    signIn(viewer.uid);
    expect((await sign(signBody)).status).toBe(403);
    expect((await sign({ ...signBody, kind: "customers" })).status).toBe(403);

    const agent = await seed("agent");
    signIn(agent.uid);
    expect((await sign(signBody)).status).toBe(403);
    expect((await sign({ ...signBody, kind: "campaigns" })).status).toBe(403);
    const ok = await sign({ ...signBody, kind: "customers" });
    expect(ok.status).toBe(200);
    expect((await json(ok)).publicId).toMatch(
      new RegExp(`^organizations/${agent.organizationId}/customers/[a-f0-9]{24}$`),
    );

    const admin = await seed("admin");
    signIn(admin.uid);
    expect((await sign({ ...signBody, kind: "campaigns" })).status).toBe(200);
  });

  it("429 on the 31st request in a minute", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    for (let i = 0; i < 30; i++) expect((await sign(signBody)).status).toBe(200);
    const res = await sign(signBody);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });
});

describe("POST /api/uploads/confirm", () => {
  it("returns the stored image shape, writes a record and never the secret", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    const id = pid(a.organizationId);
    resource.mockResolvedValue(asset(id));
    const res = await confirm({ kind: "products", publicId: id });
    expect(res.status).toBe(200);
    const out = await json(res);
    const url = `https://res.cloudinary.com/${CLOUD}/image/upload/v1700000000/${id}.png`;
    expect(out).toEqual({ url, publicId: id, width: 400, height: 300 });
    expect(JSON.stringify(out)).not.toContain(SECRET);
    const rec = await uploadRecordRef(id).get();
    expect(rec.data()).toMatchObject({
      organizationId: a.organizationId,
      kind: "products",
      publicId: id,
      url,
      width: 400,
      height: 300,
      bytes: 2000,
    });
    expect(rec.get("confirmedAt")).toBeTruthy();
  });

  it("re-confirming the same id is idempotent (the first record is kept)", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    const id = pid(a.organizationId);
    resource.mockResolvedValue(asset(id));
    expect((await confirm({ kind: "products", publicId: id })).status).toBe(200);
    const first = (await uploadRecordRef(id).get()).get("confirmedAt");
    expect((await confirm({ kind: "products", publicId: id })).status).toBe(200);
    const second = (await uploadRecordRef(id).get()).get("confirmedAt");
    expect(second.isEqual(first)).toBe(true);
  });

  it("403 for another organization's id, non-generated ids, kind mismatch and role without permission", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    expect((await confirm({ kind: "products", publicId: pid("other") })).status).toBe(403);
    expect(
      (await confirm({ kind: "products", publicId: `organizations/${a.organizationId}/products/plain` })).status,
    ).toBe(403);
    expect(
      (await confirm({ kind: "products", publicId: `${pid(a.organizationId)}.jpg` })).status,
    ).toBe(403);
    expect((await confirm({ kind: "products", publicId: pid(a.organizationId, "customers") })).status).toBe(403);
    const agent = await seed("agent");
    signIn(agent.uid);
    expect((await confirm({ kind: "products", publicId: pid(agent.organizationId) })).status).toBe(403);
    expect(resource).not.toHaveBeenCalled();
  });

  it("an agent may confirm a customers upload", async () => {
    const agent = await seed("agent");
    signIn(agent.uid);
    const id = pid(agent.organizationId, "customers");
    resource.mockResolvedValue(asset(id));
    expect((await confirm({ kind: "customers", publicId: id })).status).toBe(200);
  });

  it("400, deletes the asset and writes no record for an oversize asset", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    const id = pid(a.organizationId);
    resource.mockResolvedValue(asset(id, { bytes: 6 * 1024 * 1024 }));
    destroy.mockResolvedValue({ result: "ok" });
    expect((await confirm({ kind: "products", publicId: id })).status).toBe(400);
    expect(destroy).toHaveBeenCalledWith(id, { resource_type: "image", invalidate: true });
    expect((await uploadRecordRef(id).get()).exists).toBe(false);
  });

  it("400 and deletes a wrong-format asset", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    const id = pid(a.organizationId);
    destroy.mockResolvedValue({ result: "ok" });
    resource.mockResolvedValue(asset(id, { format: "svg" }));
    expect((await confirm({ kind: "products", publicId: id })).status).toBe(400);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("a foreign-cloud url is a deployment mismatch: generic 500, NOT destroyed, no record", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    const id = pid(a.organizationId);
    resource.mockResolvedValue(
      asset(id, { secure_url: `https://res.cloudinary.com/evil-cloud/image/upload/v1/${id}.png` }),
    );
    const res = await confirm({ kind: "products", publicId: id });
    expect(res.status).toBe(500);
    expect((await json(res)).error.code).toBe("INTERNAL_ERROR");
    expect(destroy).not.toHaveBeenCalled();
    expect((await uploadRecordRef(id).get()).exists).toBe(false);
  });

  it("404 when Cloudinary has no such asset (the SDK's nested error shape), without leaks", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    resource.mockRejectedValue(sdkError(404, "Resource not found"));
    const res = await confirm({ kind: "products", publicId: pid(a.organizationId) });
    expect(res.status).toBe(404);
    const everything = `${JSON.stringify(await json(res))}\n${logged.join("\n")}`;
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain(SECRET);
  });

  it("generic 500 without leaking credentials for any other Cloudinary error (nested shape with auth)", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    resource.mockRejectedValue(
      sdkError(
        500,
        `boom https://api.cloudinary.com/v1_1/${CLOUD}/resources?api_key=${KEY}&signature=cafef00d secret=${SECRET}`,
      ),
    );
    const res = await confirm({ kind: "products", publicId: pid(a.organizationId) });
    expect(res.status).toBe(500);
    const text = JSON.stringify(await json(res));
    const everything = `${text}\n${logged.join("\n")}`;
    expect(everything).toContain("cloudinary_request_failed"); // the capture works
    for (const needle of [KEY, SECRET, "cafef00d"]) expect(everything).not.toContain(needle);
    expect(JSON.parse(text).error.code).toBe("INTERNAL_ERROR");
  });
});

describe("confirm quotas (account-wide Admin API protection)", () => {
  const original = { ...CONFIRM_QUOTA };
  afterEach(() => Object.assign(CONFIRM_QUOTA, original));

  it("the 121st confirm in an hour from one user is 429 (real limits, injected clock)", async () => {
    const uid = `uid-${randomUUID()}`;
    const now = Date.UTC(2031, 0, 1, 0, 10);
    for (let i = 0; i < 120; i++) await assertConfirmQuota(uid, `org-${randomUUID()}`, now);
    await expect(assertConfirmQuota(uid, `org-${randomUUID()}`, now)).rejects.toBeInstanceOf(RateLimitedError);
    // The next hour is a fresh window.
    await expect(assertConfirmQuota(uid, `org-${randomUUID()}`, now + 3_600_000)).resolves.toBeUndefined();
  }, 60_000);

  it("the 301st confirm in an hour for one organization is 429, whoever sends it", async () => {
    const org = `org-${randomUUID()}`;
    const now = Date.UTC(2031, 0, 1, 0, 10);
    for (let i = 0; i < 300; i++) await assertConfirmQuota(`uid-${randomUUID()}`, org, now);
    await expect(assertConfirmQuota(`uid-${randomUUID()}`, org, now)).rejects.toBeInstanceOf(RateLimitedError);
    await expect(assertConfirmQuota(`uid-${randomUUID()}`, `org-${randomUUID()}`, now)).resolves.toBeUndefined();
  }, 60_000);

  it("the route enforces the hourly user quota before any SDK call", async () => {
    CONFIRM_QUOTA.userPerHour = 2;
    const a = await seed("owner");
    signIn(a.uid);
    resource.mockResolvedValue(asset("x"));
    const ids = [pid(a.organizationId), pid(a.organizationId), pid(a.organizationId)];
    for (const id of ids.slice(0, 2)) {
      resource.mockResolvedValueOnce(asset(id));
      expect((await confirm({ kind: "products", publicId: id })).status).toBe(200);
    }
    resource.mockClear();
    const res = await confirm({ kind: "products", publicId: ids[2]! });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(resource).not.toHaveBeenCalled();
  });

  it("the route enforces the hourly org quota across users", async () => {
    CONFIRM_QUOTA.orgPerHour = 2;
    const a = await seed("owner");
    const b = await seed("admin", a.organizationId);
    const ids = [pid(a.organizationId), pid(a.organizationId), pid(a.organizationId)];
    signIn(a.uid);
    resource.mockResolvedValueOnce(asset(ids[0]!)).mockResolvedValueOnce(asset(ids[1]!));
    expect((await confirm({ kind: "products", publicId: ids[0]! })).status).toBe(200);
    signIn(b.uid);
    expect((await confirm({ kind: "products", publicId: ids[1]! })).status).toBe(200);
    resource.mockClear();
    expect((await confirm({ kind: "products", publicId: ids[2]! })).status).toBe(429);
    expect(resource).not.toHaveBeenCalled();
  });

  it("forged ids and forbidden kinds do not spend quota", async () => {
    CONFIRM_QUOTA.userPerHour = 1;
    const a = await seed("owner");
    signIn(a.uid);
    for (let i = 0; i < 3; i++) {
      expect((await confirm({ kind: "products", publicId: pid("other") })).status).toBe(403);
      expect((await confirm({ kind: "knowledge", publicId: pid(a.organizationId, "knowledge") })).status).toBe(400);
    }
    const id = pid(a.organizationId);
    resource.mockResolvedValue(asset(id));
    expect((await confirm({ kind: "products", publicId: id })).status).toBe(200);
  });
});

describe("POST /api/uploads/delete", () => {
  it("deletes an owned asset and its record, idempotently", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    const id = pid(a.organizationId);
    resource.mockResolvedValue(asset(id));
    expect((await confirm({ kind: "products", publicId: id })).status).toBe(200);
    expect((await uploadRecordRef(id).get()).exists).toBe(true);

    destroy.mockResolvedValueOnce({ result: "ok" });
    const first = await del({ publicId: id });
    expect(first.status).toBe(200);
    expect(await json(first)).toEqual({ ok: true });
    expect((await uploadRecordRef(id).get()).exists).toBe(false);
    destroy.mockResolvedValueOnce({ result: "not found" });
    const second = await del({ publicId: id });
    expect(second.status).toBe(200);
    expect(await json(second)).toEqual({ ok: true });
    expect(destroy).toHaveBeenCalledWith(id, { resource_type: "image", invalidate: true });
  });

  it("403 for a foreign id, prefix confusion and traversal; no SDK call", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    const hex = randomBytes(12).toString("hex");
    for (const publicId of [
      pid("other"),
      `organizations/${a.organizationId}x/products/${hex}`,
      `organizations/${a.organizationId}/products/../../other/${hex}`,
      `organizations/${a.organizationId}/products/%2e%2e/${hex}`,
    ]) {
      expect((await del({ publicId })).status).toBe(403);
    }
    expect(destroy).not.toHaveBeenCalled();
  });

  it("agent may delete customers assets but not products; viewer nothing", async () => {
    const agent = await seed("agent");
    signIn(agent.uid);
    destroy.mockResolvedValue({ result: "ok" });
    expect((await del({ publicId: pid(agent.organizationId, "customers") })).status).toBe(200);
    expect((await del({ publicId: pid(agent.organizationId) })).status).toBe(403);
    const viewer = await seed("viewer");
    signIn(viewer.uid);
    expect((await del({ publicId: pid(viewer.organizationId, "customers") })).status).toBe(403);
  });
});

describe("Cloudinary not configured", () => {
  it("503 and no SDK call on all three routes", async () => {
    stubCloudinary(false);
    const a = await seed("owner");
    signIn(a.uid);
    const id = pid(a.organizationId);
    for (const res of [
      await sign(signBody),
      await confirm({ kind: "products", publicId: id }),
      await del({ publicId: id }),
    ]) {
      expect(res.status).toBe(503);
      expect((await json(res)).error.code).toBe("INTEGRATION_NOT_CONFIGURED");
    }
    expect(signSpy).not.toHaveBeenCalled();
    expect(resource).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });
});
