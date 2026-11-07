import { createHash, randomUUID } from "node:crypto";

import { v2 as cloudinary } from "cloudinary";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetEnvCacheForTests } from "@/config/env";
import { UnauthenticatedError } from "@/lib/errors";
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
const resource = vi.mocked(cloudinary.api.resource);
const destroy = vi.mocked(cloudinary.uploader.destroy);
const signSpy = vi.mocked(cloudinary.utils.api_sign_request);

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
  it("signs the member's org folder and ignores a client folder / public_id", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    const res = await sign({
      ...signBody,
      folder: "organizations/other/products",
      public_id: "organizations/other/products/steal",
      overwrite: true,
      organizationId: "other",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const out = await json(res);
    expect(out.params.folder).toBe(`organizations/${a.organizationId}/products`);
    expect(out.params).not.toHaveProperty("public_id");
    expect(out.params.overwrite).toBe("false");
    expect(out.params.unique_filename).toBe("true");
    expect(out.params.use_filename).toBe("false");
    expect(out.params.type).toBe("upload");
    expect(out.params.allowed_formats).toBe("jpg,png,webp,avif");
    expect(out.cloudName).toBe(CLOUD);
    expect(out.apiKey).toBe(KEY);
    expect(out.uploadUrl).toBe(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`);
    expect(out.maxBytes).toBe(5_242_880);
    // Independent SHA-1 over exactly the posted params.
    expect(out.signature).toBe(expectedSignature(out.params));
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  it("signature changes when the organization (folder) changes", async () => {
    const a = await seed("owner");
    const b = await seed("owner");
    signIn(a.uid);
    const first = await json(await sign(signBody));
    signIn(b.uid);
    const second = await json(await sign(signBody));
    expect(first.params.folder).not.toBe(second.params.folder);
    expect(first.signature).not.toBe(second.signature);
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
    expect((await json(ok)).params.folder).toBe(`organizations/${agent.organizationId}/customers`);

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
  it("returns the stored image shape and never the secret", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    const id = `organizations/${a.organizationId}/products/abc123`;
    resource.mockResolvedValue(asset(id));
    const res = await confirm({ kind: "products", publicId: id });
    expect(res.status).toBe(200);
    const out = await json(res);
    expect(out).toEqual({
      url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1700000000/${id}.png`,
      publicId: id,
      width: 400,
      height: 300,
    });
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  it("403 for another organization's id, kind mismatch and role without permission", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    expect((await confirm({ kind: "products", publicId: "organizations/other/products/x" })).status).toBe(403);
    expect(
      (await confirm({ kind: "products", publicId: `organizations/${a.organizationId}/customers/x` })).status,
    ).toBe(403);
    const agent = await seed("agent");
    signIn(agent.uid);
    expect(
      (await confirm({ kind: "products", publicId: `organizations/${agent.organizationId}/products/x` })).status,
    ).toBe(403);
    expect(resource).not.toHaveBeenCalled();
  });

  it("an agent may confirm a customers upload", async () => {
    const agent = await seed("agent");
    signIn(agent.uid);
    const id = `organizations/${agent.organizationId}/customers/pic`;
    resource.mockResolvedValue(asset(id));
    expect((await confirm({ kind: "customers", publicId: id })).status).toBe(200);
  });

  it("400 and deletes an oversize asset", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    const id = `organizations/${a.organizationId}/products/big`;
    resource.mockResolvedValue(asset(id, { bytes: 6 * 1024 * 1024 }));
    destroy.mockResolvedValue({ result: "ok" });
    expect((await confirm({ kind: "products", publicId: id })).status).toBe(400);
    expect(destroy).toHaveBeenCalledWith(id, { resource_type: "image", invalidate: true });
  });

  it("400 and deletes a wrong-format asset or one with a foreign-cloud url", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    const id = `organizations/${a.organizationId}/products/odd`;
    destroy.mockResolvedValue({ result: "ok" });
    resource.mockResolvedValue(asset(id, { format: "svg" }));
    expect((await confirm({ kind: "products", publicId: id })).status).toBe(400);
    resource.mockResolvedValue(
      asset(id, { secure_url: `https://res.cloudinary.com/evil-cloud/image/upload/v1/${id}.png` }),
    );
    expect((await confirm({ kind: "products", publicId: id })).status).toBe(400);
    expect(destroy).toHaveBeenCalledTimes(2);
  });

  it("404 when Cloudinary has no such asset", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    resource.mockRejectedValue({ message: "Resource not found", http_code: 404 });
    const res = await confirm({ kind: "products", publicId: `organizations/${a.organizationId}/products/gone` });
    expect(res.status).toBe(404);
  });

  it("generic 500 without leaking credentials for any other Cloudinary error", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    resource.mockRejectedValue({
      message: `boom https://api.cloudinary.com/v1_1/${CLOUD}/resources?api_key=${KEY}&signature=cafef00d secret=${SECRET}`,
      http_code: 500,
    });
    const res = await confirm({ kind: "products", publicId: `organizations/${a.organizationId}/products/x` });
    expect(res.status).toBe(500);
    const text = JSON.stringify(await json(res));
    const everything = `${text}\n${logged.join("\n")}`;
    expect(everything).toContain("cloudinary_request_failed"); // the capture works
    for (const needle of [KEY, SECRET, "cafef00d"]) expect(everything).not.toContain(needle);
    expect(JSON.parse(text).error.code).toBe("INTERNAL_ERROR");
  });
});

describe("POST /api/uploads/delete", () => {
  it("deletes an owned asset, idempotently", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    const id = `organizations/${a.organizationId}/products/del1`;
    destroy.mockResolvedValueOnce({ result: "ok" });
    const first = await del({ publicId: id });
    expect(first.status).toBe(200);
    expect(await json(first)).toEqual({ ok: true });
    destroy.mockResolvedValueOnce({ result: "not found" });
    const second = await del({ publicId: id });
    expect(second.status).toBe(200);
    expect(await json(second)).toEqual({ ok: true });
    expect(destroy).toHaveBeenCalledWith(id, { resource_type: "image", invalidate: true });
  });

  it("403 for a foreign id, prefix confusion and traversal; no SDK call", async () => {
    const a = await seed("owner");
    signIn(a.uid);
    for (const publicId of [
      "organizations/other/products/x",
      `organizations/${a.organizationId}x/products/x`,
      `organizations/${a.organizationId}/products/../../other/x`,
      `organizations/${a.organizationId}/products/%2e%2e/x`,
    ]) {
      expect((await del({ publicId })).status).toBe(403);
    }
    expect(destroy).not.toHaveBeenCalled();
  });

  it("agent may delete customers assets but not products; viewer nothing", async () => {
    const agent = await seed("agent");
    signIn(agent.uid);
    destroy.mockResolvedValue({ result: "ok" });
    expect((await del({ publicId: `organizations/${agent.organizationId}/customers/x` })).status).toBe(200);
    expect((await del({ publicId: `organizations/${agent.organizationId}/products/x` })).status).toBe(403);
    const viewer = await seed("viewer");
    signIn(viewer.uid);
    expect((await del({ publicId: `organizations/${viewer.organizationId}/customers/x` })).status).toBe(403);
  });
});

describe("Cloudinary not configured", () => {
  it("503 and no SDK call on all three routes", async () => {
    stubCloudinary(false);
    const a = await seed("owner");
    signIn(a.uid);
    const id = `organizations/${a.organizationId}/products/x`;
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
