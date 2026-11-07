import { describe, expect, it } from "vitest";

import { optimizedUrl, thumbUrl } from "./urls";

const BASE = "https://res.cloudinary.com/demo/image/upload";
const ID = "organizations/A/products/abc123.jpg";

describe("thumbUrl", () => {
  it("inserts a fill transformation after /image/upload/", () => {
    expect(thumbUrl(`${BASE}/v123/${ID}`, 200, 150)).toBe(`${BASE}/c_fill,w_200,h_150,f_auto,q_auto/v123/${ID}`);
    expect(thumbUrl(`${BASE}/${ID}`, 64, 64)).toContain("c_fill");
  });

  it("is idempotent", () => {
    const once = thumbUrl(`${BASE}/v1/${ID}`, 200, 200);
    expect(thumbUrl(once, 200, 200)).toBe(once);
    expect(optimizedUrl(optimizedUrl(`${BASE}/v1/${ID}`))).toBe(optimizedUrl(`${BASE}/v1/${ID}`));
  });

  it("does not mistake an organizations/ public id for a transformation", () => {
    expect(thumbUrl(`${BASE}/${ID}`, 10, 10)).toBe(`${BASE}/c_fill,w_10,h_10,f_auto,q_auto/${ID}`);
  });

  it.each([0, -1, 4001, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("returns the original for size %s", (n) => {
    const url = `${BASE}/v1/${ID}`;
    expect(thumbUrl(url, n, 100)).toBe(url);
    expect(thumbUrl(url, 100, n)).toBe(url);
  });

  it("accepts the 1 and 4000 bounds", () => {
    expect(thumbUrl(`${BASE}/v1/${ID}`, 1, 4000)).toContain("w_1,h_4000");
  });

  it("leaves foreign, non-https and non-upload URLs untouched", () => {
    for (const u of [
      "https://example.com/demo/image/upload/x.jpg",
      "http://res.cloudinary.com/demo/image/upload/x.jpg",
      "https://res.cloudinary.com/demo/video/upload/x.mp4",
      "https://res.cloudinary.com.evil.com/demo/image/upload/x.jpg",
      "https://user:pw@res.cloudinary.com/demo/image/upload/x.jpg",
      "https://res.cloudinary.com/demo/raw/upload/image/upload/x.jpg",
      "not a url",
      "",
    ]) {
      expect(thumbUrl(u, 100, 100)).toBe(u);
      expect(optimizedUrl(u)).toBe(u);
    }
  });

  it("only treats the marker right after the cloud name as the upload segment", () => {
    const u = "https://res.cloudinary.com/demo/image/upload/v1/organizations/A/products/image/upload/x.jpg";
    expect(optimizedUrl(u)).toBe(
      "https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/v1/organizations/A/products/image/upload/x.jpg",
    );
  });

  it("never contains a secret", () => {
    const secret = "s3cr3t-value";
    process.env.CLOUDINARY_API_SECRET = secret;
    try {
      expect(thumbUrl(`${BASE}/v1/${ID}`, 100, 100)).not.toContain(secret);
    } finally {
      delete process.env.CLOUDINARY_API_SECRET;
    }
  });
});

describe("optimizedUrl", () => {
  it("inserts f_auto,q_auto", () => {
    expect(optimizedUrl(`${BASE}/v1/${ID}`)).toBe(`${BASE}/f_auto,q_auto/v1/${ID}`);
  });
  it("keeps the query string", () => {
    expect(optimizedUrl(`${BASE}/v1/${ID}?x=1`)).toBe(`${BASE}/f_auto,q_auto/v1/${ID}?x=1`);
  });
});
