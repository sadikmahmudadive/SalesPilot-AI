import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILTERS,
  hasActiveCriteria,
  isSearchActive,
  toListParams,
  type ListFilterState,
} from "@/components/customers/list-params";

const state = (patch: Partial<ListFilterState>): ListFilterState => ({
  ...DEFAULT_FILTERS,
  ...patch,
});

describe("toListParams", () => {
  it("maps each sort option to sort and dir", () => {
    expect(toListParams(state({ sortKey: "newest" }))).toMatchObject({
      sort: "createdAt",
      dir: "desc",
    });
    expect(toListParams(state({ sortKey: "name-asc" }))).toMatchObject({
      sort: "fullName",
      dir: "asc",
    });
    expect(toListParams(state({ sortKey: "name-desc" }))).toMatchObject({
      sort: "fullName",
      dir: "desc",
    });
    expect(toListParams(state({ sortKey: "recent" }))).toMatchObject({
      sort: "lastInteractionAt",
      dir: "desc",
    });
  });

  it("ignores searches shorter than 2 characters", () => {
    expect(toListParams(state({ search: "a" })).q).toBeUndefined();
    expect(toListParams(state({ search: " r " })).q).toBeUndefined();
    expect(toListParams(state({ search: " ra " })).q).toBe("ra");
  });

  it("sends only the selected filter's value", () => {
    expect(
      toListParams(state({ filterBy: "segment", segment: "converted", tag: "vip" })),
    ).toMatchObject({
      segment: "converted",
    });
    expect(toListParams(state({ filterBy: "segment", segment: "converted" })).tag).toBeUndefined();
    expect(toListParams(state({ filterBy: "tag", tag: " vip " })).tag).toBe("vip");
    expect(
      toListParams(state({ filterBy: "customerType", customerType: "wholesale" })).customerType,
    ).toBe("wholesale");
  });

  it("drops the filter while a search is active", () => {
    const p = toListParams(state({ search: "rahim", filterBy: "segment", segment: "converted" }));
    expect(p.q).toBe("rahim");
    expect(p.segment).toBeUndefined();
  });

  it("sends nothing for a filter with no value chosen yet", () => {
    const p = toListParams(state({ filterBy: "segment", segment: "" }));
    expect(p.segment).toBeUndefined();
  });

  it("always asks for 25 per page", () => {
    expect(toListParams(DEFAULT_FILTERS).limit).toBe(25);
  });
});

describe("isSearchActive / hasActiveCriteria", () => {
  it("needs 2 non-blank characters", () => {
    expect(isSearchActive(" a ")).toBe(false);
    expect(isSearchActive("ab")).toBe(true);
  });

  it("reports whether the list is narrowed by a search or a filter value", () => {
    expect(hasActiveCriteria(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveCriteria(state({ search: "ra" }))).toBe(true);
    expect(hasActiveCriteria(state({ filterBy: "tag", tag: "vip" }))).toBe(true);
    expect(hasActiveCriteria(state({ filterBy: "tag", tag: "" }))).toBe(false);
    expect(hasActiveCriteria(state({ sortKey: "name-asc" }))).toBe(false);
  });
});
