import { describe, expect, it } from "vitest";
import {
  AiProviderError,
  AppError,
  ConflictError,
  ForbiddenError,
  InsufficientStockError,
  IntegrationNotConfiguredError,
  InventoryBusyError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  UnsupportedMediaTypeError,
  ValidationError,
} from "./errors";

describe("errors", () => {
  const cases: Array<[string, AppError, number, string]> = [
    ["ValidationError", new ValidationError(), 400, "VALIDATION_ERROR"],
    ["UnauthenticatedError", new UnauthenticatedError(), 401, "UNAUTHENTICATED"],
    ["ForbiddenError", new ForbiddenError(), 403, "FORBIDDEN"],
    ["NotFoundError", new NotFoundError(), 404, "NOT_FOUND"],
    ["ConflictError", new ConflictError(), 409, "CONFLICT"],
    ["InsufficientStockError", new InsufficientStockError(), 409, "INSUFFICIENT_STOCK"],
    ["UnsupportedMediaTypeError", new UnsupportedMediaTypeError(), 415, "UNSUPPORTED_MEDIA_TYPE"],
    ["RateLimitedError", new RateLimitedError(30), 429, "RATE_LIMITED"],
    [
      "IntegrationNotConfiguredError",
      new IntegrationNotConfiguredError("zalo"),
      503,
      "INTEGRATION_NOT_CONFIGURED",
    ],
    ["AiProviderError", new AiProviderError("timeout"), 503, "AI_PROVIDER_ERROR"],
    ["AiProviderError", new AiProviderError("bad_request"), 502, "AI_PROVIDER_ERROR"],
  ];

  it.each(cases)("%s maps to status and code", (name, err, status, code) => {
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(status);
    expect(err.code).toBe(code);
    expect(err.name).toBe(name);
    expect(err.message.length).toBeGreaterThan(0);
  });

  it("ValidationError carries details", () => {
    const details = [{ path: "email", message: "Invalid email" }];
    expect(new ValidationError(details).details).toEqual(details);
    expect(new ValidationError().details).toBeUndefined();
  });

  it("RateLimitedError carries retryAfterSec", () => {
    expect(new RateLimitedError(12).retryAfterSec).toBe(12);
  });

  it.each([
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
    [-5, 1],
    [2.2, 3],
    [30, 30],
  ])("RateLimitedError(%s) normalises retryAfterSec to %i", (input, expected) => {
    const err = new RateLimitedError(input);
    expect(err.retryAfterSec).toBe(expected);
    expect(Number.isInteger(err.retryAfterSec)).toBe(true);
  });

  it("AppError instances carry the shared brand", () => {
    expect(
      (new NotFoundError() as unknown as Record<symbol, unknown>)[
        Symbol.for("salespilot.appError")
      ],
    ).toBe(true);
  });

  it("IntegrationNotConfiguredError carries integration name", () => {
    const err = new IntegrationNotConfiguredError("zalo");
    expect(err.integration).toBe("zalo");
    expect(err.message).toContain("zalo");
  });

  it("InventoryBusyError is a retryable 409 CONFLICT that is distinguishable from other conflicts", () => {
    const busy = new InventoryBusyError();
    expect(busy).toBeInstanceOf(ConflictError);
    expect(busy).toBeInstanceOf(AppError);
    expect(busy.status).toBe(409);
    expect(busy.code).toBe("CONFLICT");
    expect(busy.message).toBe("Inventory is busy, please try again");
    expect(busy.name).toBe("InventoryBusyError");
    expect(new ConflictError()).not.toBeInstanceOf(InventoryBusyError);
  });
});
