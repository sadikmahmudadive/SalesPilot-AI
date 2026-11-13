import { describe, expect, it } from "vitest";

import { DEFAULT_ORDER_FILTERS, parseOrderSearch, toOrderListParams } from "./order-list-params";

describe("parseOrderSearch", () => {
  it("treats blank input as no search", () => {
    expect(parseOrderSearch("")).toEqual({ kind: "none" });
    expect(parseOrderSearch("   ")).toEqual({ kind: "none" });
  });

  it("accepts order numbers in any case", () => {
    expect(parseOrderSearch(" SP-000123 ")).toEqual({ kind: "valid", q: "SP-000123" });
    expect(parseOrderSearch("sp-12")).toEqual({ kind: "valid", q: "sp-12" });
  });

  it("accepts phone numbers that normalize", () => {
    expect(parseOrderSearch("01712345678")).toEqual({ kind: "valid", q: "01712345678" });
    expect(parseOrderSearch("+8801712345678")).toEqual({ kind: "valid", q: "+8801712345678" });
  });

  it("rejects anything else", () => {
    for (const bad of ["rahim", "SP-", "SP-12a", "SP12", "0171", "123456"]) {
      expect(parseOrderSearch(bad)).toEqual({ kind: "invalid" });
    }
  });
});

describe("toOrderListParams", () => {
  const base = DEFAULT_ORDER_FILTERS;

  it("sends only the page size by default", () => {
    expect(toOrderListParams(base)).toEqual({ limit: 25 });
  });

  it("sends the chosen status or payment status", () => {
    expect(toOrderListParams({ ...base, status: "draft" })).toEqual({ limit: 25, status: "draft" });
    expect(toOrderListParams({ ...base, paymentStatus: "paid" })).toEqual({
      limit: 25,
      paymentStatus: "paid",
    });
  });

  it("sends only q for a valid search", () => {
    expect(toOrderListParams({ ...base, status: "draft", search: " SP-1 " })).toEqual({
      limit: 25,
      q: "SP-1",
    });
  });

  it("sends no q for an invalid search", () => {
    expect(toOrderListParams({ ...base, status: "draft", search: "abc" })).toEqual({
      limit: 25,
      status: "draft",
    });
  });
});
