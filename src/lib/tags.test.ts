import { describe, expect, it } from "vitest";

import { tagKey as queryTagKey } from "@/services/crm/customer-query";
import { customerInputSchema } from "@/schemas/customer";
import { dedupeTags, tagKey } from "@/lib/tags";

describe("tagKey", () => {
  it("trims and lower-cases", () => {
    expect(tagKey("  VIP ")).toBe("vip");
  });

  it("is the same function the query layer uses", () => {
    for (const t of ["VIP", " Dhaka ", "Wholesale"]) expect(queryTagKey(t)).toBe(tagKey(t));
  });

  it("applies NFKC (full-width letters collapse onto ASCII)", () => {
    expect(tagKey(String.fromCodePoint(0xff36, 0xff29, 0xff30))).toBe("vip");
  });
});

describe("dedupeTags", () => {
  it("drops blanks and case-insensitive duplicates, keeping the first spelling", () => {
    expect(dedupeTags(["VIP", " vip ", "", "  ", "new", "NEW"])).toEqual(["VIP", "new"]);
  });

  it("collapses tags the service would index identically", () => {
    expect(dedupeTags(["vip", String.fromCodePoint(0xff36, 0xff29, 0xff30)])).toEqual(["vip"]);
  });

  it("agrees with the schema's own de-duplication for ordinary input", () => {
    const inputs = [["VIP", "vip", "Dhaka"], ["a", "A", "b", "B", "c"], ["x"], []];
    for (const tags of inputs) {
      const parsed = customerInputSchema.parse({
        fullName: "A",
        phone: "01811111111",
        tags,
      });
      expect(parsed.tags).toEqual(dedupeTags(tags));
    }
  });

  it("produces a list the schema keeps unchanged, even when the schema would keep more", () => {
    const fullWidth = String.fromCodePoint(0xff36, 0xff29, 0xff30);
    const tags = dedupeTags(["vip", fullWidth, "Dhaka"]);
    const parsed = customerInputSchema.parse({ fullName: "A", phone: "01811111111", tags });
    expect(parsed.tags).toEqual(tags);
  });
});
