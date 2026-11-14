import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthenticatedError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { Role } from "@/lib/security/permissions";
import { NUMBER_TAKEN_MESSAGE } from "@/services/whatsapp/connections";

import { DELETE, GET, PUT } from "./route";
import { POST as TEST } from "./test/route";

let session: { uid: string; email: string | null } | null = null;
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => {
    if (!session) throw new UnauthenticatedError();
    return session;
  }),
}));

vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 5).toString("base64"));

const TOKEN = "EAAG-route-test-token-000001";
const URL_BASE = "http://localhost/api/integrations/whatsapp";
const orgs = new Set<string>();
let counter = 0;
const newNumber = () => {
  const n = `8${String(Date.now()).slice(-8)}${++counter}`;
  used.add(n);
  return n;
};

async function seed(role: Role) {
  const organizationId = `org-${randomUUID()}`;
  const uid = `uid-${randomUUID()}`;
  const db = adminDb();
  await db.collection("users").doc(uid).set({ uid, email: `${uid}@test.com`, defaultOrganizationId: organizationId });
  await db.collection("organizationMembers").doc(`${organizationId}_${uid}`).set({ organizationId, uid, role });
  orgs.add(organizationId);
  session = { uid, email: `${uid}@test.com` };
  return { uid, organizationId };
}

function req(method: string, body?: unknown, headers: Record<string, string> = {}): Request {
  const raw = body === undefined ? undefined : JSON.stringify(body);
  const h = new Headers(headers);
  if (raw !== undefined) {
    h.set("content-type", "application/json");
    h.set("content-length", String(Buffer.byteLength(raw)));
  }
  return new Request(URL_BASE, { method, headers: h, body: raw });
}

/** Meta accepts TOKEN for every number these tests use. */
const acceptAll = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  const auth = new Headers(init?.headers).get("authorization");
  if (auth !== `Bearer ${TOKEN}`) return Response.json({ error: {} }, { status: 401 });
  const [, id = "", edge] = url.pathname.split("/").filter(Boolean);
  if (edge === "phone_numbers") return Response.json({ data: [...used].map((n) => ({ id: n })) });
  return Response.json({ id, display_phone_number: "+880 1711-000000", verified_name: "Shop" });
}) as typeof fetch;
const used = new Set<string>();
vi.stubGlobal("fetch", acceptAll);

const input = (phoneNumberId: string) => ({
  phoneNumberId,
  businessAccountId: "102290129340398",
  accessToken: TOKEN,
  enabled: true,
});

beforeEach(() => {
  session = null;
});

afterAll(async () => {
  const db = adminDb();
  for (const orgId of orgs) {
    await db.collection("whatsappConnections").doc(orgId).delete();
    const locks = await db.collection("whatsappPhoneNumbers").where("organizationId", "==", orgId).get();
    await Promise.all(locks.docs.map((d) => d.ref.delete()));
  }
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("WhatsApp connection API", () => {
  it("rejects unauthenticated callers", async () => {
    expect((await GET(req("GET"))).status).toBe(401);
  });

  it.each<Role>(["agent", "viewer"])("forbids %s on every route", async (role) => {
    await seed(role);
    expect((await GET(req("GET"))).status).toBe(403);
    expect((await PUT(req("PUT", input(newNumber())))).status).toBe(403);
    expect((await TEST(req("POST"))).status).toBe(403);
    expect((await DELETE(req("DELETE"))).status).toBe(403);
  });

  it("lets an owner save, read, and disconnect without ever returning the token", async () => {
    await seed("owner");
    const number = newNumber();
    const saved = await PUT(req("PUT", input(number)));
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body).toMatchObject({ connected: true, phoneNumberId: number, hasAccessToken: true });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(body.credentials).toBeUndefined();

    const read = await (await GET(req("GET"))).json();
    expect(read.connected).toBe(true);
    expect(JSON.stringify(read)).not.toContain(TOKEN);

    expect((await DELETE(req("DELETE"))).status).toBe(204);
    expect((await (await GET(req("GET"))).json()).connected).toBe(false);
  });

  it("returns 409 for a number another workspace connected", async () => {
    const number = newNumber();
    await seed("owner");
    expect((await PUT(req("PUT", input(number)))).status).toBe(200);
    await seed("admin");
    const res = await PUT(req("PUT", input(number)));
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toBe(NUMBER_TAKEN_MESSAGE);
  });

  it("rejects a cross-site save", async () => {
    await seed("owner");
    const res = await PUT(req("PUT", input(newNumber()), { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("rejects invalid input with a validation error", async () => {
    await seed("owner");
    const res = await PUT(req("PUT", { phoneNumberId: "abc", businessAccountId: "1", enabled: true }));
    expect(res.status).toBe(400);
  });
});
