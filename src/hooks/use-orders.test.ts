import { describe, expect, it } from "vitest";

import { actionRequest, orderListQueryString } from "@/hooks/use-orders";

const keys = (qs: string) => [...new URLSearchParams(qs).keys()];

describe("orderListQueryString", () => {
  it("is empty for no params", () => {
    expect(orderListQueryString({})).toBe("");
  });

  it("drops blank and whitespace-only values", () => {
    expect(
      orderListQueryString({
        status: "",
        paymentStatus: "",
        q: "  ",
        customerId: " ",
        from: "",
        to: "",
        cursor: "",
      }),
    ).toBe("");
  });

  it("trims and encodes q", () => {
    expect(orderListQueryString({ q: " +880 17 " })).toBe("q=%2B880+17");
  });

  it("keeps the cursor and limit", () => {
    const qs = new URLSearchParams(
      orderListQueryString({ status: "draft", limit: 25, cursor: "abc" }),
    );
    expect(qs.get("status")).toBe("draft");
    expect(qs.get("limit")).toBe("25");
    expect(qs.get("cursor")).toBe("abc");
  });

  it("keeps one equality filter plus the date range", () => {
    expect(
      keys(
        orderListQueryString({
          status: "shipped",
          paymentStatus: "paid",
          customerId: "c1",
          from: "2026-11-01T00:00:00.000Z",
          to: "2026-11-02T00:00:00.000Z",
        }),
      ),
    ).toEqual(["status", "from", "to"]);
  });

  it("falls through to the next filter when the first is blank", () => {
    expect(keys(orderListQueryString({ status: "", paymentStatus: "paid" }))).toEqual([
      "paymentStatus",
    ]);
  });

  it("sends only q and paging when a search is present", () => {
    expect(
      keys(
        orderListQueryString({
          q: "SP-000123",
          status: "draft",
          from: "2026-11-01T00:00:00.000Z",
          limit: 10,
          cursor: "c",
        }),
      ).sort(),
    ).toEqual(["cursor", "limit", "q"]);
  });
});

describe("actionRequest", () => {
  it("sends an empty object for process by default", () => {
    expect(actionRequest("process")).toEqual({});
    expect(actionRequest("process", undefined)).toEqual({});
  });

  it("passes the override reason through for process", () => {
    expect(actionRequest("process", { allowUnpaidReason: "Paid by bKash" })).toEqual({
      allowUnpaidReason: "Paid by bKash",
    });
  });

  it("passes the reason for cancel and refund", () => {
    expect(actionRequest("cancel", { reason: "Out of stock" })).toEqual({ reason: "Out of stock" });
    expect(actionRequest("refund", { reason: "Damaged" })).toEqual({ reason: "Damaged" });
  });

  it("sends no body for confirm, ship, deliver and return", () => {
    for (const action of ["confirm", "ship", "deliver", "return"] as const) {
      expect(actionRequest(action)).toBeUndefined();
    }
  });
});
