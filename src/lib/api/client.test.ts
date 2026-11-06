import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "@/lib/api/client";

function stubFetch(impl: (input: string, init: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("apiFetch", () => {
  it("returns parsed JSON on success and uses same-origin credentials", async () => {
    const fetchFn = stubFetch(async () => Response.json({ items: [1] }));
    await expect(apiFetch<{ items: number[] }>("/api/customers")).resolves.toEqual({ items: [1] });
    const [path, init] = fetchFn.mock.calls[0]!;
    expect(path).toBe("/api/customers");
    expect(init.credentials).toBe("same-origin");
    expect(init.method).toBe("GET");
  });

  it("sends Content-Type and a JSON body only when a body exists", async () => {
    const fetchFn = stubFetch(async () => Response.json({ ok: true }, { status: 201 }));
    await apiFetch("/api/customers", { method: "POST", body: { a: 1 } });
    const withBody = fetchFn.mock.calls[0]![1];
    expect(new Headers(withBody.headers).get("content-type")).toBe("application/json");
    expect(withBody.body).toBe('{"a":1}');

    await apiFetch("/api/customers");
    const without = fetchFn.mock.calls[1]![1];
    expect(new Headers(without.headers).has("content-type")).toBe(false);
    expect(without.body).toBeUndefined();
  });

  it("returns undefined for 204 No Content", async () => {
    stubFetch(async () => new Response(null, { status: 204 }));
    await expect(apiFetch("/api/customers/x", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("maps the error envelope onto ApiError", async () => {
    stubFetch(async () =>
      Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid input",
            requestId: "req-1",
            details: [{ path: "phone", message: "Enter a valid mobile number" }],
          },
        },
        { status: 400 },
      ),
    );
    const err = await apiFetch("/api/customers", { method: "POST", body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid input",
      requestId: "req-1",
      details: [{ path: "phone", message: "Enter a valid mobile number" }],
    });
  });

  it("maps HTTP 401 to code UNAUTHENTICATED even without an envelope", async () => {
    stubFetch(async () => new Response("nope", { status: 401 }));
    const err = (await apiFetch("/api/customers").catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(401);
    expect(err.code).toBe("UNAUTHENTICATED");
  });

  it("handles non-JSON error bodies with a generic message", async () => {
    stubFetch(async () => new Response("<html>Bad gateway</html>", { status: 502 }));
    const err = (await apiFetch("/api/customers").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.code).toBe("HTTP_ERROR");
    expect(err.message).not.toContain("html");
    expect(err.requestId).toBeUndefined();
    expect(err.details).toEqual([]);
  });

  it("ignores malformed details entries", async () => {
    stubFetch(async () =>
      Response.json(
        { error: { code: "X", message: "m", details: [{ path: 1 }, null, { path: "a", message: "b" }] } },
        { status: 400 },
      ),
    );
    const err = (await apiFetch("/api/customers").catch((e: unknown) => e)) as ApiError;
    expect(err.details).toEqual([{ path: "a", message: "b" }]);
  });

  it("turns a network failure into ApiError NETWORK", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const err = (await apiFetch("/api/customers").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("NETWORK");
    expect(err.status).toBe(0);
  });

  it("passes the abort signal through and rethrows aborts untouched", async () => {
    const controller = new AbortController();
    const fetchFn = stubFetch(async (_p, init) => {
      if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return Response.json({});
    });
    controller.abort();
    const err = await apiFetch("/api/customers", { signal: controller.signal }).catch((e: unknown) => e);
    expect(fetchFn.mock.calls[0]![1].signal).toBe(controller.signal);
    expect(err).not.toBeInstanceOf(ApiError);
    expect((err as DOMException).name).toBe("AbortError");
  });

  it("treats an invalid JSON success body as an ApiError", async () => {
    stubFetch(async () => new Response("not json", { status: 200 }));
    const err = (await apiFetch("/api/customers").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("BAD_RESPONSE");
  });
});
