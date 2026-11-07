import { describe, expect, it } from "vitest";

import {
  CONSENT_STATUSES,
  CUSTOMER_SEGMENTS,
  CUSTOMER_TYPES,
  customerInputSchema,
  customerPatchSchema,
} from "./customer";

const base = { fullName: "Rahim Uddin", phone: "01712-345678" };

function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return (result.error?.issues ?? []).map((i) => i.path.join("."));
}

describe("constants", () => {
  it("exposes the domain enums", () => {
    expect(CUSTOMER_SEGMENTS).toEqual([
      "new_lead",
      "interested",
      "qualified_lead",
      "potential_buyer",
      "converted",
      "repeat_customer",
      "wholesale_customer",
      "inactive",
    ]);
    expect(CUSTOMER_TYPES).toEqual(["retail", "wholesale"]);
    expect(CONSENT_STATUSES).toEqual(["granted", "denied", "unknown"]);
  });
});

describe("customerInputSchema", () => {
  it("applies defaults and derives phoneE164", () => {
    expect(customerInputSchema.parse(base)).toEqual({
      fullName: "Rahim Uddin",
      phone: "01712-345678",
      phoneE164: "+8801712345678",
      customerType: "retail",
      tags: [],
      segment: "new_lead",
      consent: { status: "unknown" },
    });
  });

  it("defaults consent to { status: 'unknown' }", () => {
    expect(customerInputSchema.parse(base).consent).toEqual({ status: "unknown" });
  });

  it("accepts a Bangla name and NFC-normalizes it", () => {
    expect(
      customerInputSchema.parse({
        ...base,
        fullName: "\u09B0\u09B9\u09BF\u09AE \u0989\u09A6\u09CD\u09A6\u09BF\u09A8",
      }).fullName,
    ).toBe("\u09B0\u09B9\u09BF\u09AE \u0989\u09A6\u09CD\u09A6\u09BF\u09A8");
    // "e" + combining acute (NFD) -> single code point (NFC)
    expect(customerInputSchema.parse({ ...base, fullName: "Jose\u0301" }).fullName).toBe(
      "Jos\u00E9",
    );
  });

  it("trims the name and rejects blank / too long names", () => {
    expect(customerInputSchema.parse({ ...base, fullName: "  Karim  " }).fullName).toBe("Karim");
    expect(customerInputSchema.safeParse({ ...base, fullName: "   " }).success).toBe(false);
    expect(customerInputSchema.safeParse({ ...base, fullName: "" }).success).toBe(false);
    expect(customerInputSchema.safeParse({ ...base, fullName: "a".repeat(121) }).success).toBe(
      false,
    );
    expect(customerInputSchema.safeParse({ ...base, fullName: "a".repeat(120) }).success).toBe(
      true,
    );
  });

  it("rejects an unknown segment, customer type and consent status", () => {
    expect(customerInputSchema.safeParse({ ...base, segment: "vip" }).success).toBe(false);
    expect(customerInputSchema.safeParse({ ...base, customerType: "vip" }).success).toBe(false);
    expect(customerInputSchema.safeParse({ ...base, consent: { status: "maybe" } }).success).toBe(
      false,
    );
  });

  it("accepts every segment", () => {
    for (const segment of CUSTOMER_SEGMENTS) {
      expect(customerInputSchema.parse({ ...base, segment }).segment).toBe(segment);
    }
  });

  describe("phone", () => {
    it("requires a phone", () => {
      const r = customerInputSchema.safeParse({ fullName: "A" });
      expect(r.success).toBe(false);
      expect(issuePaths(r)).toContain("phone");
    });

    it("rejects an invalid phone with a static message on `phone` that does not echo the value", () => {
      const r = customerInputSchema.safeParse({ ...base, phone: "not-a-number-SECRET" });
      expect(r.success).toBe(false);
      expect(issuePaths(r)).toEqual(["phone"]);
      const message = r.error!.issues[0]?.message;
      expect(message).toBe("Enter a valid mobile number");
      expect(JSON.stringify(r.error!.issues)).not.toContain("SECRET");
    });

    it("keeps the trimmed raw phone for display and adds phoneE164", () => {
      const r = customerInputSchema.parse({ ...base, phone: "  +880 1712 345678  " });
      expect(r.phone).toBe("+880 1712 345678");
      expect(r.phoneE164).toBe("+8801712345678");
    });

    it("rejects a non-string phone", () => {
      expect(customerInputSchema.safeParse({ ...base, phone: 1712345678 }).success).toBe(false);
    });
  });

  describe("whatsappNumber", () => {
    it("is optional and omitted when empty or whitespace", () => {
      for (const whatsappNumber of [undefined, "", "   "]) {
        const r = customerInputSchema.parse({ ...base, whatsappNumber });
        expect(r).not.toHaveProperty("whatsappNumber");
        expect(r).not.toHaveProperty("whatsappE164");
      }
    });

    it("normalizes and adds whatsappE164 when present", () => {
      const r = customerInputSchema.parse({ ...base, whatsappNumber: " 01812-345678 " });
      expect(r.whatsappNumber).toBe("01812-345678");
      expect(r.whatsappE164).toBe("+8801812345678");
    });

    it("rejects an invalid number on `whatsappNumber`", () => {
      const r = customerInputSchema.safeParse({ ...base, whatsappNumber: "12345" });
      expect(r.success).toBe(false);
      expect(issuePaths(r)).toEqual(["whatsappNumber"]);
    });
  });

  describe("email", () => {
    it("trims and lowercases", () => {
      expect(customerInputSchema.parse({ ...base, email: "  Rahim@Example.COM " }).email).toBe(
        "rahim@example.com",
      );
    });

    it("omits an empty email", () => {
      for (const email of ["", "   ", undefined]) {
        expect(customerInputSchema.parse({ ...base, email })).not.toHaveProperty("email");
      }
    });

    it("rejects an invalid email without echoing it", () => {
      const r = customerInputSchema.safeParse({ ...base, email: "not-an-email-SECRET" });
      expect(r.success).toBe(false);
      expect(issuePaths(r)).toEqual(["email"]);
      expect(JSON.stringify(r.error!.issues)).not.toContain("SECRET");
    });
  });

  describe("optional text fields", () => {
    it("trims address and leadSource and enforces max lengths", () => {
      const r = customerInputSchema.parse({
        ...base,
        address: "  Dhaka  ",
        leadSource: " Facebook ",
      });
      expect(r.address).toBe("Dhaka");
      expect(r.leadSource).toBe("Facebook");
      expect(customerInputSchema.safeParse({ ...base, address: "a".repeat(500) }).success).toBe(
        true,
      );
      expect(customerInputSchema.safeParse({ ...base, address: "a".repeat(501) }).success).toBe(
        false,
      );
      expect(customerInputSchema.safeParse({ ...base, leadSource: "a".repeat(80) }).success).toBe(
        true,
      );
      expect(customerInputSchema.safeParse({ ...base, leadSource: "a".repeat(81) }).success).toBe(
        false,
      );
    });
  });

  describe("tags", () => {
    it("trims, drops nothing valid, and de-dupes case-insensitively keeping the first spelling", () => {
      const r = customerInputSchema.parse({ ...base, tags: ["VIP", " vip ", "Eid", "EID", "new"] });
      expect(r.tags).toEqual(["VIP", "Eid", "new"]);
    });

    it("rejects 21 distinct tags and accepts 20", () => {
      const tags = (n: number) => Array.from({ length: n }, (_, i) => `tag${i}`);
      expect(customerInputSchema.safeParse({ ...base, tags: tags(21) }).success).toBe(false);
      expect(customerInputSchema.safeParse({ ...base, tags: tags(20) }).success).toBe(true);
    });

    it("counts the limit after de-duplication", () => {
      const tags = [...Array.from({ length: 20 }, (_, i) => `tag${i}`), "TAG0", "Tag1"];
      expect(customerInputSchema.parse({ ...base, tags }).tags).toHaveLength(20);
    });

    it("rejects empty/blank tags and tags over 40 chars", () => {
      expect(customerInputSchema.safeParse({ ...base, tags: ["  "] }).success).toBe(false);
      expect(customerInputSchema.safeParse({ ...base, tags: [""] }).success).toBe(false);
      expect(customerInputSchema.safeParse({ ...base, tags: ["a".repeat(41)] }).success).toBe(
        false,
      );
      expect(customerInputSchema.safeParse({ ...base, tags: ["a".repeat(40)] }).success).toBe(true);
    });

    it("rejects a non-array", () => {
      expect(customerInputSchema.safeParse({ ...base, tags: "vip" }).success).toBe(false);
    });
  });

  describe("preferences", () => {
    it("accepts language and notes, rejects bad language and long notes", () => {
      expect(
        customerInputSchema.parse({ ...base, preferences: { language: "bn", notes: " hi " } })
          .preferences,
      ).toEqual({
        language: "bn",
        notes: "hi",
      });
      expect(
        customerInputSchema.safeParse({ ...base, preferences: { language: "fr" } }).success,
      ).toBe(false);
      expect(
        customerInputSchema.safeParse({ ...base, preferences: { notes: "a".repeat(1001) } })
          .success,
      ).toBe(false);
      expect(
        customerInputSchema.safeParse({ ...base, preferences: { notes: "a".repeat(1000) } })
          .success,
      ).toBe(true);
    });
  });

  describe("assignedAgentId", () => {
    it("accepts a valid id segment and rejects slashes/reserved ids", () => {
      expect(
        customerInputSchema.parse({ ...base, assignedAgentId: "uid_123" }).assignedAgentId,
      ).toBe("uid_123");
      for (const bad of ["a/b", "..", "__x__", ""]) {
        expect(customerInputSchema.safeParse({ ...base, assignedAgentId: bad }).success).toBe(
          false,
        );
      }
    });
  });

  describe("consent", () => {
    it("rejects granted without source with the error on consent.source", () => {
      const r = customerInputSchema.safeParse({ ...base, consent: { status: "granted" } });
      expect(r.success).toBe(false);
      expect(issuePaths(r)).toEqual(["consent.source"]);
    });

    it("rejects granted with a blank source", () => {
      expect(
        customerInputSchema.safeParse({ ...base, consent: { status: "granted", source: "  " } })
          .success,
      ).toBe(false);
    });

    it("accepts granted with a source and an ISO timestamp", () => {
      const consent = { status: "granted", at: "2026-11-06T10:00:00Z", source: "whatsapp_optin" };
      expect(customerInputSchema.parse({ ...base, consent }).consent).toEqual(consent);
    });

    it("accepts denied/unknown without source", () => {
      expect(customerInputSchema.parse({ ...base, consent: { status: "denied" } }).consent).toEqual(
        { status: "denied" },
      );
    });

    it("rejects a non-ISO `at` and an overlong source", () => {
      expect(
        customerInputSchema.safeParse({ ...base, consent: { status: "denied", at: "yesterday" } })
          .success,
      ).toBe(false);
      expect(
        customerInputSchema.safeParse({
          ...base,
          consent: { status: "denied", source: "a".repeat(81) },
        }).success,
      ).toBe(false);
    });
  });

  describe("unknown / server-owned keys", () => {
    it("strips client-supplied server fields and cannot forge derived fields", () => {
      const r = customerInputSchema.parse({
        ...base,
        organizationId: "other-org",
        id: "forged",
        totalSpendMinor: 999999,
        createdAt: "2020-01-01T00:00:00Z",
        phoneE164: "+10000000000",
        whatsappE164: "+10000000001",
        fullNameLower: "x",
        extra: 1,
      });
      for (const key of [
        "organizationId",
        "id",
        "totalSpendMinor",
        "createdAt",
        "whatsappE164",
        "fullNameLower",
        "extra",
      ]) {
        expect(r).not.toHaveProperty(key);
      }
      expect(r.phoneE164).toBe("+8801712345678");
    });
  });

  describe("robustness", () => {
    it("never throws; fails cleanly for non-object input", () => {
      for (const input of [null, undefined, "x", 1, true, [], [base], () => 1, Symbol("s")]) {
        const run = () => customerInputSchema.safeParse(input);
        expect(run).not.toThrow();
        expect(run().success).toBe(false);
      }
    });

    it("does not throw for wrong-typed fields", () => {
      const run = () =>
        customerInputSchema.safeParse({
          fullName: 1,
          phone: {},
          email: [],
          tags: [1, null],
          consent: "granted",
          preferences: null,
        });
      expect(run).not.toThrow();
      expect(run().success).toBe(false);
    });

    it("does not echo the submitted fullName in error messages", () => {
      const r = customerInputSchema.safeParse({ ...base, fullName: "a".repeat(200) });
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error!.issues)).not.toContain("aaaaaaaaaa");
    });
  });
});

describe("customerPatchSchema", () => {
  it("parses { fullName } to exactly { fullName } (no defaults)", () => {
    expect(customerPatchSchema.parse({ fullName: " Karim " })).toEqual({ fullName: "Karim" });
  });

  it("does not reset consent, tags, segment or customerType", () => {
    const r = customerPatchSchema.parse({ phone: "01712345678" });
    expect(r).toEqual({ phone: "01712345678", phoneE164: "+8801712345678" });
    for (const key of ["consent", "tags", "segment", "customerType"])
      expect(r).not.toHaveProperty(key);
  });

  it("derives phoneE164 and whatsappE164 when present", () => {
    expect(customerPatchSchema.parse({ whatsappNumber: "01812-345678" })).toEqual({
      whatsappNumber: "01812-345678",
      whatsappE164: "+8801812345678",
    });
  });

  it("validates fields it is given", () => {
    expect(customerPatchSchema.safeParse({ phone: "abc" }).success).toBe(false);
    expect(customerPatchSchema.safeParse({ segment: "vip" }).success).toBe(false);
    expect(
      customerPatchSchema.safeParse({ tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })
        .success,
    ).toBe(false);
    expect(customerPatchSchema.parse({ tags: ["A", "a"] })).toEqual({ tags: ["A"] });
    expect(customerPatchSchema.parse({ email: " A@B.CO " })).toEqual({ email: "a@b.co" });
  });

  it("still enforces granted-needs-source when consent is patched", () => {
    const r = customerPatchSchema.safeParse({ consent: { status: "granted" } });
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toEqual(["consent.source"]);
  });

  it("rejects an empty patch", () => {
    const r = customerPatchSchema.safeParse({});
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]?.message).toBe("At least one field is required");
  });

  it("rejects a patch containing only unknown keys (they strip to empty)", () => {
    expect(customerPatchSchema.safeParse({ organizationId: "x", id: "y" }).success).toBe(false);
  });

  it("rejects a whitespace-only name", () => {
    expect(customerPatchSchema.safeParse({ fullName: "   " }).success).toBe(false);
  });

  it("strips forged server fields", () => {
    const r = customerPatchSchema.parse({
      fullName: "A",
      phoneE164: "+1",
      organizationId: "o",
      totalSpendMinor: 5,
    });
    expect(r).toEqual({ fullName: "A" });
  });

  it("never throws on non-object input", () => {
    for (const input of [null, undefined, "x", 1, [], [{ fullName: "A" }]]) {
      const run = () => customerPatchSchema.safeParse(input);
      expect(run).not.toThrow();
      expect(run().success).toBe(false);
    }
  });
});

describe("customerInputSchema: display text and invisible characters", () => {
  it("cleans control/format characters and collapses whitespace in the stored raw phone", () => {
    const r = customerInputSchema.parse({ ...base, phone: "0171\n2345678" });
    expect(r.phone).toBe("0171 2345678");
    expect(r.phoneE164).toBe("+8801712345678");
    expect(
      customerInputSchema.parse({ ...base, phone: " +880 \t 1712\u200b   345678\u202c " }).phone,
    ).toBe("+880 1712 345678");
    expect(customerInputSchema.parse({ ...base, phone: "\u202a01712345678\u202c" }).phone).toBe(
      "01712345678",
    );
  });

  it("cleans the stored raw whatsappNumber the same way", () => {
    const r = customerInputSchema.parse({ ...base, whatsappNumber: "01812\r\n\u200b345678" });
    expect(r.whatsappNumber).toBe("01812 345678");
    expect(r.whatsappE164).toBe("+8801812345678");
  });

  it("accepts a pasted phone with bidi marks and full-width digits", () => {
    const r = customerInputSchema.parse({ ...base, phone: "\u200e+880 1712 345678\u200f" });
    expect(r.phoneE164).toBe("+8801712345678");
    expect(customerInputSchema.safeParse({ ...base, phone: "x".repeat(201) }).success).toBe(false);
  });

  it("treats an invisible-only name as blank but keeps ZWNJ/ZWJ inside real names", () => {
    expect(customerInputSchema.safeParse({ ...base, fullName: "\u200b\u2060\ufeff" }).success).toBe(
      false,
    );
    expect(customerInputSchema.safeParse({ ...base, fullName: " \u200b \u202e " }).success).toBe(
      false,
    );
    expect(customerInputSchema.safeParse({ ...base, fullName: "\u200d\u200c" }).success).toBe(
      false,
    );
    expect(customerInputSchema.parse({ ...base, fullName: "\u202eAli\u200b" }).fullName).toBe(
      "Ali",
    );
    expect(
      customerInputSchema.parse({ ...base, fullName: "\u09b0\u200d\u09cd\u09af" }).fullName,
    ).toBe("\u09b0\u200d\u09cd\u09af");
  });

  it("caps email at 254 characters", () => {
    const local = "a".repeat(64);
    const ok = `${local}@${"b".repeat(60)}.com`;
    expect(customerInputSchema.parse({ ...base, email: ok }).email).toBe(ok);
    const tooLong = `${local}@${"b".repeat(200)}.com`;
    expect(tooLong.length).toBeGreaterThan(254);
    expect(customerInputSchema.safeParse({ ...base, email: tooLong }).success).toBe(false);
    expect(customerInputSchema.safeParse({ ...base, email: "a".repeat(1_000_000) }).success).toBe(
      false,
    );
  });

  it("rejects null for clearable fields on create (null only means 'clear' in PATCH)", () => {
    for (const key of ["email", "whatsappNumber", "address", "leadSource"]) {
      expect(customerInputSchema.safeParse({ ...base, [key]: null }).success).toBe(false);
    }
  });
});

describe("customerPatchSchema: clearing optional fields", () => {
  it.each([
    [{ email: null }, { email: null }],
    [{ email: "" }, { email: null }],
    [{ email: "   " }, { email: null }],
    [{ address: "" }, { address: null }],
    [{ address: null }, { address: null }],
    [{ leadSource: "  " }, { leadSource: null }],
    [{ leadSource: null }, { leadSource: null }],
    [{ whatsappNumber: null }, { whatsappNumber: null, whatsappE164: null }],
    [{ whatsappNumber: "" }, { whatsappNumber: null, whatsappE164: null }],
    [{ whatsappNumber: "\u200b" }, { whatsappNumber: null, whatsappE164: null }],
  ])("%j -> %j", (input, expected) => {
    expect(customerPatchSchema.parse(input)).toStrictEqual(expected);
  });

  it("a blank-only patch is a valid clear, not an empty patch", () => {
    expect(customerPatchSchema.safeParse({ email: "" }).success).toBe(true);
  });

  it("an empty patch is still rejected", () => {
    const r = customerPatchSchema.safeParse({});
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]?.message).toBe("At least one field is required");
  });

  it("replacing whatsappNumber recomputes whatsappE164; other fields leave it untouched", () => {
    expect(customerPatchSchema.parse({ whatsappNumber: "01912-345678" })).toStrictEqual({
      whatsappNumber: "01912-345678",
      whatsappE164: "+8801912345678",
    });
    expect(customerPatchSchema.parse({ address: "Dhaka" })).toStrictEqual({ address: "Dhaka" });
  });

  it("still validates non-blank values and trims them", () => {
    expect(customerPatchSchema.safeParse({ email: "nope" }).success).toBe(false);
    expect(customerPatchSchema.safeParse({ whatsappNumber: "12345" }).success).toBe(false);
    expect(customerPatchSchema.safeParse({ address: "a".repeat(501) }).success).toBe(false);
    expect(customerPatchSchema.safeParse({ email: 5 }).success).toBe(false);
    expect(customerPatchSchema.parse({ address: "  Dhaka " })).toStrictEqual({ address: "Dhaka" });
  });

  it("cannot clear phone (required) with null or blank", () => {
    expect(customerPatchSchema.safeParse({ phone: null }).success).toBe(false);
    expect(customerPatchSchema.safeParse({ phone: "" }).success).toBe(false);
  });

  it("applies the same display cleaning to patched phone", () => {
    expect(customerPatchSchema.parse({ phone: "0171\n2345678" })).toStrictEqual({
      phone: "0171 2345678",
      phoneE164: "+8801712345678",
    });
  });

  it("matches the create output exactly for derived-field shape (toStrictEqual)", () => {
    expect(customerInputSchema.parse({ ...base, email: "" })).toStrictEqual({
      fullName: "Rahim Uddin",
      phone: "01712-345678",
      phoneE164: "+8801712345678",
      customerType: "retail",
      tags: [],
      segment: "new_lead",
      consent: { status: "unknown" },
    });
  });
});
