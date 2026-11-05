import { describe, expect, it } from "vitest";

import { ForbiddenError, UnsupportedMediaTypeError } from "@/lib/errors";

import { assertJsonSameOrigin } from "./csrf";

const URL_ = "https://app.example.com/api/thing";

function req(method: string, headers: Record<string, string> = {}, body: BodyInit | null = "{}", url = URL_): Request {
  return new Request(url, { method, headers, body: method === "GET" || method === "HEAD" ? null : body });
}
const json = { "content-type": "application/json" };

describe("assertJsonSameOrigin: content type", () => {
  it.each([
    "application/json",
    "APPLICATION/JSON",
    "application/json; charset=utf-8",
    "application/json;charset=UTF-8",
    "Application/Json ; charset=utf-8",
  ])("accepts %s", (ct) => {
    expect(() => assertJsonSameOrigin(req("POST", { "content-type": ct }))).not.toThrow();
  });

  it.each([
    "text/plain",
    "text/plain;charset=UTF-8",
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=x",
    "application/jsonp",
    "application/json-patch+json",
    "application/vnd.api+json",
    "text/json",
    "application/jsonx; application/json",
    "",
  ])("rejects %j with UnsupportedMediaTypeError (415)", (ct) => {
    const err = (() => {
      try {
        assertJsonSameOrigin(req("POST", ct ? { "content-type": ct } : {}));
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(UnsupportedMediaTypeError);
    expect((err as UnsupportedMediaTypeError).status).toBe(415);
  });

  it("a text/plain body without any content-type header (undici defaults to text/plain) is rejected", () => {
    expect(() => assertJsonSameOrigin(req("POST", {}, "{}"))).toThrow(UnsupportedMediaTypeError);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s with a non-JSON body is rejected", (m) => {
    expect(() => assertJsonSameOrigin(req(m, { "content-type": "text/plain" }))).toThrow(UnsupportedMediaTypeError);
  });

  it("a body-less mutating request needs no content type", () => {
    expect(() => assertJsonSameOrigin(req("POST", {}, null))).not.toThrow();
  });

  it("requireJson: false skips only the content-type check", () => {
    expect(() => assertJsonSameOrigin(req("DELETE", { "content-type": "text/plain" }), { requireJson: false })).not.toThrow();
    expect(() =>
      assertJsonSameOrigin(req("DELETE", { origin: "https://evil.com" }, null), { requireJson: false }),
    ).toThrow(ForbiddenError);
  });

  it.each(["GET", "HEAD", "OPTIONS"])("%s is never checked", (m) => {
    expect(() =>
      assertJsonSameOrigin(req(m, { origin: "https://evil.com", "sec-fetch-site": "cross-site" }, null)),
    ).not.toThrow();
  });
});

describe("assertJsonSameOrigin: Origin", () => {
  it("accepts a matching Origin", () => {
    expect(() => assertJsonSameOrigin(req("POST", { ...json, origin: "https://app.example.com" }))).not.toThrow();
  });

  it("accepts a missing Origin (non-browser clients)", () => {
    expect(() => assertJsonSameOrigin(req("POST", json))).not.toThrow();
  });

  it.each([
    "https://evil.com",
    "http://app.example.com", // scheme downgrade
    "https://app.example.com:8443",
    "https://app.example.com.evil.com",
    "https://evilapp.example.com",
    "null",
    "not a url",
    "",
  ])("rejects Origin %j with ForbiddenError (403)", (origin) => {
    const err = (() => {
      try {
        assertJsonSameOrigin(req("POST", { ...json, origin }));
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it("a Host header alone cannot legitimise a foreign Origin", () => {
    // Host spoofing: Origin evil.com + Host evil.com must not pass against a request URL on another host.
    const r = req("POST", { ...json, origin: "https://evil.com", host: "evil.com" });
    expect(() => assertJsonSameOrigin(r)).toThrow(ForbiddenError);
  });

  it("accepts the forwarded public origin behind a proxy (Vercel)", () => {
    const r = req(
      "POST",
      { ...json, origin: "https://public.example.org", "x-forwarded-host": "public.example.org", "x-forwarded-proto": "https" },
      "{}",
      "http://localhost:3000/api/thing",
    );
    expect(() => assertJsonSameOrigin(r)).not.toThrow();
  });

  it("uses the first entry of comma-separated forwarded headers", () => {
    const r = req(
      "POST",
      { ...json, origin: "https://public.example.org", "x-forwarded-host": "public.example.org, internal", "x-forwarded-proto": "https, http" },
      "{}",
      "http://localhost:3000/api/thing",
    );
    expect(() => assertJsonSameOrigin(r)).not.toThrow();
  });

  it("forwarded host with a different scheme than Origin is rejected", () => {
    const r = req(
      "POST",
      { ...json, origin: "http://public.example.org", "x-forwarded-host": "public.example.org", "x-forwarded-proto": "https" },
      "{}",
      "http://localhost:3000/api/thing",
    );
    expect(() => assertJsonSameOrigin(r)).toThrow(ForbiddenError);
  });

  it("a foreign Origin is still rejected when forwarded headers describe a different host", () => {
    const r = req("POST", { ...json, origin: "https://evil.com", "x-forwarded-host": "public.example.org", "x-forwarded-proto": "https" });
    expect(() => assertJsonSameOrigin(r)).toThrow(ForbiddenError);
  });
});

describe("assertJsonSameOrigin: Sec-Fetch-Site", () => {
  it.each(["same-origin", "none", "SAME-ORIGIN"])("accepts %s", (v) => {
    expect(() => assertJsonSameOrigin(req("POST", { ...json, "sec-fetch-site": v }))).not.toThrow();
  });

  it.each(["cross-site", "same-site", "bogus", ""])("rejects %j with ForbiddenError", (v) => {
    expect(() => assertJsonSameOrigin(req("POST", { ...json, "sec-fetch-site": v }))).toThrow(ForbiddenError);
  });

  it("rejects cross-site even when Origin looks fine", () => {
    expect(() =>
      assertJsonSameOrigin(req("POST", { ...json, origin: "https://app.example.com", "sec-fetch-site": "cross-site" })),
    ).toThrow(ForbiddenError);
  });
});

describe("assertJsonSameOrigin: precedence", () => {
  it("cross-origin text/plain is a 403 (origin checked before content type)", () => {
    const r = req("POST", { "content-type": "text/plain", origin: "https://evil.com" });
    expect(() => assertJsonSameOrigin(r)).toThrow(ForbiddenError);
  });
});
