import { describe, expect, it } from "vitest";

import { buildCustomersQuery } from "@/hooks/use-customers";

const str = (p: Parameters<typeof buildCustomersQuery>[0]) => buildCustomersQuery(p).toString();

describe("buildCustomersQuery", () => {
  it("is empty for no params", () => {
    expect(str({})).toBe("");
  });

  it("includes sort, dir, limit and cursor", () => {
    const q = buildCustomersQuery({ sort: "fullName", dir: "asc", limit: 25, cursor: "abc" });
    expect(q.get("sort")).toBe("fullName");
    expect(q.get("dir")).toBe("asc");
    expect(q.get("limit")).toBe("25");
    expect(q.get("cursor")).toBe("abc");
  });

  it("drops empty and whitespace-only values", () => {
    expect(str({ q: "  ", segment: "", tag: "   ", cursor: "" })).toBe("");
  });

  it("trims values", () => {
    expect(buildCustomersQuery({ tag: "  vip " }).get("tag")).toBe("vip");
  });

  it("drops all filters when q is present", () => {
    const q = buildCustomersQuery({ q: "rahim", segment: "converted", tag: "vip" });
    expect(q.get("q")).toBe("rahim");
    expect(q.has("segment")).toBe(false);
    expect(q.has("tag")).toBe(false);
  });

  it("keeps only one filter, by priority segment > customerType > tag > assignedAgentId", () => {
    const q = buildCustomersQuery({
      segment: "converted",
      customerType: "retail",
      tag: "vip",
      assignedAgentId: "u1",
    });
    expect([...q.keys()]).toEqual(["segment"]);
    expect([...buildCustomersQuery({ customerType: "retail", tag: "vip" }).keys()]).toEqual([
      "customerType",
    ]);
    expect([...buildCustomersQuery({ tag: "vip", assignedAgentId: "u1" }).keys()]).toEqual(["tag"]);
  });

  it("falls through to the next filter when the higher-priority one is empty", () => {
    expect([...buildCustomersQuery({ segment: "", customerType: "wholesale" }).keys()]).toEqual([
      "customerType",
    ]);
  });

  it("keeps a filter when q is blank", () => {
    expect(buildCustomersQuery({ q: " ", segment: "inactive" }).get("segment")).toBe("inactive");
  });

  it("ignores a non-positive limit", () => {
    expect(buildCustomersQuery({ limit: 0 }).has("limit")).toBe(false);
  });
});
