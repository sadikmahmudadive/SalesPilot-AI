import { describe, expect, it } from "vitest";

import { thumbnailUrl } from "@/lib/image-url";

const URL_ = "https://res.cloudinary.com/demo/image/upload/v1/organizations/o1/products/shirt.jpg";

describe("thumbnailUrl", () => {
  it("inserts a fill transformation after /image/upload/", () => {
    expect(thumbnailUrl(URL_, 96)).toBe(
      "https://res.cloudinary.com/demo/image/upload/c_fill,w_96,h_96,f_auto,q_auto/v1/organizations/o1/products/shirt.jpg",
    );
  });

  it("returns other hosts and malformed input unchanged", () => {
    expect(thumbnailUrl("https://example.com/a.jpg", 96)).toBe("https://example.com/a.jpg");
    expect(thumbnailUrl("not a url", 96)).toBe("not a url");
    expect(thumbnailUrl("https://res.cloudinary.com/demo/raw/upload/file.pdf", 96)).toBe(
      "https://res.cloudinary.com/demo/raw/upload/file.pdf",
    );
  });

  it("clamps the size to a sane range", () => {
    expect(thumbnailUrl(URL_, 0)).toContain("w_16,h_16");
    expect(thumbnailUrl(URL_, 99999)).toContain("w_1600,h_1600");
  });
});
