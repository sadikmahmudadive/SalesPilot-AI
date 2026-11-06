import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/errors";

import {
  MAX_SEARCH_LENGTH,
  PREFIX_END,
  buildListPlan,
  fullNameLowerKey,
  parseListParams,
  planSearch,
  tagKey,
  tagKeys,
} from "./customer-query";

/** ASCII digits to Bangla digits, built from code points so the source stays ASCII. */
const bn = (s: string) => s.replace(/\d/g, (d) => String.fromCodePoint(0x09e6 + Number(d)));
const RAHIM = String.fromCodePoint(0x09b0, 0x09b9, 0x09bf, 0x09ae);

describe("fullNameLowerKey", () => {
  it("NFKC + lowercases, collapses whitespace, trims", () => {
    expect(fullNameLowerKey("  Md.   SADIK  ")).toBe("md. sadik");
  });
  it("folds full-width letters", () => {
    expect(fullNameLowerKey(String.fromCodePoint(0xff21, 0xff22))).toBe("ab");
  });
  it("keeps Bangla untouched", () => {
    expect(fullNameLowerKey(RAHIM)).toBe(RAHIM);
  });
  it("truncates to 256 UTF-16 units without splitting a surrogate pair", () => {
    const emoji = String.fromCodePoint(0x1f600);
    expect(fullNameLowerKey("a".repeat(255) + emoji)).toBe("a".repeat(255));
    expect(fullNameLowerKey("a".repeat(300))).toHaveLength(256);
  });
});

describe("tagKey / tagKeys", () => {
  it("lower-cases, trims, applies NFKC and de-duplicates", () => {
    expect(tagKey("  VIP ")).toBe("vip");
    expect(tagKeys(["VIP", "vip", " Vip ", "Dhaka"])).toEqual(["vip", "dhaka"]);
    expect(tagKeys([])).toEqual([]);
  });
});

describe("planSearch", () => {
  it("name search: lowercased NFKC prefix range on fullNameLower", () => {
    expect(planSearch("  RAHIM ")).toEqual({
      kind: "name",
      field: "fullNameLower",
      start: "rahim",
      end: "rahim" + PREFIX_END,
    });
  });
  it("Bangla names go to the name search", () => {
    const plan = planSearch(RAHIM);
    expect(plan.kind).toBe("name");
    expect(plan.start).toBe(RAHIM);
  });
  it("leading 0 becomes +880 (phone prefix search)", () => {
    expect(planSearch("0171")).toEqual({
      kind: "phone",
      field: "phoneE164",
      start: "+880171",
      end: "+880171" + PREFIX_END,
    });
  });
  it("tolerates punctuation and Bangla digits", () => {
    expect(planSearch("01712-34").start).toBe("+880171234");
    expect(planSearch(bn("01712")).start).toBe("+8801712");
    expect(planSearch("(017) 12").start).toBe("+8801712");
  });
  it("keeps a + prefix, maps 00 to +, and treats 880 without a plus as international", () => {
    expect(planSearch("+8801712").start).toBe("+8801712");
    expect(planSearch("008801712").start).toBe("+8801712");
    expect(planSearch("8801712").start).toBe("+8801712");
  });
  it("needs at least 3 digits for a phone search; fewer is a name search", () => {
    expect(planSearch("01").kind).toBe("name");
    expect(planSearch("017").kind).toBe("phone");
  });
  it("mixed letters and digits are a name search", () => {
    expect(planSearch("bob 123").kind).toBe("name");
  });
  it("rejects queries longer than the limit and lone surrogates", () => {
    expect(() => planSearch("a".repeat(MAX_SEARCH_LENGTH + 1))).toThrow(ValidationError);
    expect(() => planSearch("a".repeat(MAX_SEARCH_LENGTH))).not.toThrow();
    expect(() => planSearch("ab" + String.fromCharCode(0xd800))).toThrow(ValidationError);
  });
  it("the upper bound sorts (in UTF-8 byte order, as Firestore does) above any string with the prefix", () => {
    const { start, end } = planSearch("jo");
    const emoji = "jo" + String.fromCodePoint(0x1f600);
    expect(Buffer.from(emoji).compare(Buffer.from(start))).toBeGreaterThan(0);
    expect(Buffer.from(emoji).compare(Buffer.from(end))).toBeLessThan(0);
    expect(Buffer.from("jp").compare(Buffer.from(end))).toBeGreaterThan(0);
  });
});

describe("buildListPlan", () => {
  const base = { sort: "createdAt", dir: "desc" } as const;

  it("maps sort names to stored fields, default limit 25", () => {
    expect(buildListPlan({ ...base, sort: "fullName", dir: "asc" })).toMatchObject({
      where: [],
      orderBy: ["fullNameLower", "asc"],
      limit: 25,
      shape: { orderField: "fullNameLower", direction: "asc" },
    });
    expect(buildListPlan({ ...base, sort: "lastInteractionAt" }).orderBy).toEqual([
      "lastInteractionAt",
      "desc",
    ]);
    expect(buildListPlan(base).orderBy).toEqual(["createdAt", "desc"]);
  });

  it("builds a single equality / array-contains filter", () => {
    expect(buildListPlan({ ...base, segment: "converted" }).where).toEqual([
      ["segment", "==", "converted"],
    ]);
    expect(buildListPlan({ ...base, customerType: "wholesale" }).where).toEqual([
      ["customerType", "==", "wholesale"],
    ]);
    expect(buildListPlan({ ...base, assignedAgentId: "a1" }).where).toEqual([
      ["assignedAgentId", "==", "a1"],
    ]);
    const tag = buildListPlan({ ...base, tag: "vip" });
    expect(tag.where).toEqual([["tagsLower", "array-contains", "vip"]]);
    expect(tag.shape.filterField).toBe("tagsLower");
  });

  it("normalises the tag filter: trimmed, NFKC, case-insensitive; blank or oversized tags are rejected", () => {
    const where = (tag: string) => buildListPlan({ ...base, tag }).where;
    expect(where("  VIP ")).toEqual([["tagsLower", "array-contains", "vip"]]);
    expect(where(String.fromCodePoint(0xff36, 0xff29, 0xff30))).toEqual([
      ["tagsLower", "array-contains", "vip"],
    ]);
    expect(() => buildListPlan({ ...base, tag: "   " })).toThrow(ValidationError);
    expect(() => buildListPlan({ ...base, tag: "x".repeat(81) })).toThrow(ValidationError);
    expect(() => buildListPlan({ ...base, tag: "a" + String.fromCharCode(0xd800) })).toThrow(
      ValidationError,
    );
  });

  it("rejects two or more filters", () => {
    expect(() => buildListPlan({ ...base, segment: "converted", tag: "vip" })).toThrow(
      /one filter/,
    );
    expect(() => buildListPlan({ ...base, customerType: "retail", assignedAgentId: "a" })).toThrow(
      ValidationError,
    );
  });

  it("rejects search combined with any filter", () => {
    expect(() => buildListPlan({ ...base, search: "jo", segment: "converted" })).toThrow(
      ValidationError,
    );
    expect(() => buildListPlan({ ...base, search: "jo", tag: "x" })).toThrow(ValidationError);
  });

  it("search forces its own order and ignores sort/dir", () => {
    const name = buildListPlan({ ...base, search: "Jo", sort: "lastInteractionAt", dir: "desc" });
    expect(name.orderBy).toEqual(["fullNameLower", "asc"]);
    expect(name.where).toEqual([
      ["fullNameLower", ">=", "jo"],
      ["fullNameLower", "<", "jo" + PREFIX_END],
    ]);
    const phone = buildListPlan({ ...base, search: "0171" });
    expect(phone.orderBy).toEqual(["phoneE164", "asc"]);
    expect(phone.where[0]).toEqual(["phoneE164", ">=", "+880171"]);
  });

  it("blank search is ignored", () => {
    expect(buildListPlan({ ...base, search: "   " }).where).toEqual([]);
  });

  it("limit: default 25, 1..50 only", () => {
    expect(buildListPlan({ ...base, limit: 50 }).limit).toBe(50);
    for (const limit of [0, 51, -1, 1.5, Number.NaN]) {
      expect(() => buildListPlan({ ...base, limit })).toThrow(ValidationError);
    }
  });

  it("rejects unknown sort, dir and filter values", () => {
    expect(() => buildListPlan({ sort: "phone" as never, dir: "asc" })).toThrow(ValidationError);
    expect(() => buildListPlan({ sort: "createdAt", dir: "up" as never })).toThrow(ValidationError);
    expect(() => buildListPlan({ ...base, segment: "nope" as never })).toThrow(ValidationError);
    expect(() => buildListPlan({ ...base, customerType: "nope" as never })).toThrow(
      ValidationError,
    );
  });
});

describe("parseListParams", () => {
  const p = (qs: string) => parseListParams(new URL(`http://x/api/customers?${qs}`).searchParams);

  it("applies defaults: createdAt desc; fullName defaults to asc", () => {
    expect(p("")).toEqual({ sort: "createdAt", dir: "desc" });
    expect(p("sort=fullName")).toMatchObject({ sort: "fullName", dir: "asc" });
    expect(p("sort=fullName&dir=desc")).toMatchObject({ dir: "desc" });
  });
  it("parses every supported param and ignores unknown ones", () => {
    expect(
      p(
        "q=jo&segment=converted&customerType=retail&tag=vip&assignedAgentId=a1&limit=10&cursor=abc&zzz=1",
      ),
    ).toEqual({
      search: "jo",
      segment: "converted",
      customerType: "retail",
      tag: "vip",
      assignedAgentId: "a1",
      sort: "createdAt",
      dir: "desc",
      limit: 10,
      cursor: "abc",
    });
  });
  it("empty values are treated as absent", () => {
    expect(p("q=&segment=&tag=&cursor=&limit=")).toEqual({ sort: "createdAt", dir: "desc" });
  });
  it("rejects repeated params", () => {
    expect(() => p("segment=converted&segment=inactive")).toThrow(ValidationError);
    expect(() => p("q=a&q=b")).toThrow(ValidationError);
  });
  it("rejects bad values with a ValidationError that never echoes them", () => {
    const bad = [
      "limit=0",
      "limit=51",
      "limit=abc",
      "limit=1e1",
      "sort=phone",
      "dir=up",
      "segment=nope",
      "assignedAgentId=a%2Fb",
      "q=" + "a".repeat(65),
    ];
    for (const qs of bad) {
      expect(() => p(qs), qs).toThrow(ValidationError);
    }
    try {
      p("segment=SECRETVALUE");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect(JSON.stringify((e as ValidationError).details)).not.toContain("SECRETVALUE");
    }
  });
});
