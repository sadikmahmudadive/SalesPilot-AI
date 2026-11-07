import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/client";
import { asApiError, mapApiErrorWith } from "@/lib/api/map-error";

const api = (init: Partial<ConstructorParameters<typeof ApiError>[0]> = {}) =>
  new ApiError({ status: 400, code: "VALIDATION_ERROR", message: "Invalid", ...init });

const options = {
  toField: (path: string) => (path === "name" ? ("name" as const) : null),
  onConflict: () => ({ fields: [{ name: "name" as const, message: "taken" }], formError: null }),
};

describe("mapApiErrorWith", () => {
  it("delegates conflicts and keeps the request id", () => {
    const r = mapApiErrorWith(api({ status: 409, code: "CONFLICT", requestId: "r1" }), options);
    expect(r).toEqual({
      fields: [{ name: "name", message: "taken" }],
      formError: null,
      requestId: "r1",
    });
  });

  it("maps known detail paths and joins the unknown ones", () => {
    const r = mapApiErrorWith(
      api({
        details: [
          { path: "name", message: "Required" },
          { path: "x", message: "A" },
          { path: "y", message: "B" },
        ],
      }),
      options,
    );
    expect(r.fields).toEqual([{ name: "name", message: "Required" }]);
    expect(r.formError).toBe("A B");
  });

  it("falls back to the error message", () => {
    expect(
      mapApiErrorWith(api({ status: 500, code: "INTERNAL_ERROR", message: "Boom" }), options)
        .formError,
    ).toBe("Boom");
  });
});

describe("asApiError", () => {
  it("passes ApiError through and wraps anything else", () => {
    const e = api();
    expect(asApiError(e)).toBe(e);
    const wrapped = asApiError(new TypeError("x"));
    expect(wrapped).toBeInstanceOf(ApiError);
    expect(wrapped.code).toBe("UNKNOWN");
  });
});
