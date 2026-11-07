import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import { MAX_IMAGE_BYTES, type UploadKind } from "@/lib/cloudinary/folders";
import type { ConfirmedUpload, SignedUpload } from "@/schemas/upload";

import { precheckFile, runUpload, UploadFlowError, type UploadDeps, type UploadOutcome } from "./upload-flow";

const PUBLIC_ID = "organizations/org1/products/0123456789abcdef01234567";

const SIGNED: SignedUpload = {
  cloudName: "demo",
  apiKey: "key-123",
  uploadUrl: "https://api.cloudinary.com/v1_1/demo/image/upload",
  publicId: PUBLIC_ID,
  params: {
    public_id: PUBLIC_ID,
    timestamp: "1700000000",
    allowed_formats: "jpg,png,webp,avif",
    overwrite: "0",
    type: "upload",
  },
  signature: "sig-abc",
  maxBytes: MAX_IMAGE_BYTES,
};

const CONFIRMED: ConfirmedUpload = {
  url: `https://res.cloudinary.com/demo/image/upload/v1/${PUBLIC_ID}.jpg`,
  publicId: PUBLIC_ID,
  width: 800,
  height: 600,
};

const png = (bytes = 1024, name = "shirt.png", type = "image/png") => new File([new Uint8Array(bytes)], name, { type });

function makeDeps(overrides: Partial<UploadDeps> = {}) {
  const calls: string[] = [];
  const post = vi.fn<(path: string, body?: unknown, signal?: AbortSignal) => Promise<never>>(async (path) => {
    calls.push(path);
    return (path === "/api/uploads/sign" ? SIGNED : CONFIRMED) as never;
  });
  const xhrUpload = vi.fn<UploadDeps["xhrUpload"]>(async () => {
    calls.push("xhr");
    return { public_id: "attacker/chosen/id", secure_url: "https://evil.example/x.png" };
  });
  const deps: UploadDeps = { post, xhrUpload, createFormData: () => new FormData(), ...overrides };
  return { deps, post, xhrUpload, calls };
}

const apiError = (status: number, code = "HTTP_ERROR") => new ApiError({ status, code, message: "server text" });

async function outcomeOf(promise: Promise<unknown>): Promise<UploadOutcome> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(UploadFlowError);
    return (error as UploadFlowError).outcome;
  }
  throw new Error("expected the upload to fail");
}

describe("precheckFile", () => {
  it("accepts an allowed type within the size limit", () => {
    expect(precheckFile("products", png())).toBeNull();
  });
  it("rejects an empty file, a wrong type and an oversized file with static messages", () => {
    expect(precheckFile("products", png(0))).toMatch(/empty/i);
    expect(precheckFile("products", png(10, "a.gif", "image/gif"))).toMatch(/JPEG|PNG/);
    expect(precheckFile("products", png(MAX_IMAGE_BYTES + 1))).toMatch(/5 MB/);
    expect(precheckFile("products", png(MAX_IMAGE_BYTES))).toBeNull();
  });
  it("rejects a kind with no upload policy", () => {
    expect(precheckFile("knowledge" as UploadKind, png())).toMatch(/not available/i);
  });
});

describe("runUpload", () => {
  it("signs, uploads, then confirms, and returns the confirm result", async () => {
    const { deps, calls } = makeDeps();
    const result = await runUpload(deps, "products", png());
    expect(calls).toEqual(["/api/uploads/sign", "xhr", "/api/uploads/confirm"]);
    expect(result).toEqual(CONFIRMED);
  });

  it("sends kind, contentType and bytes to sign", async () => {
    const { deps, post } = makeDeps();
    await runUpload(deps, "products", png(2048));
    expect(post.mock.calls[0]?.[0]).toBe("/api/uploads/sign");
    expect(post.mock.calls[0]?.[1]).toEqual({ kind: "products", contentType: "image/png", bytes: 2048 });
  });

  it("builds the multipart body from exactly params + api_key + signature + file", async () => {
    const { deps, xhrUpload } = makeDeps();
    await runUpload(deps, "products", png());
    const [url, body] = xhrUpload.mock.calls[0] as unknown as [string, FormData];
    expect(url).toBe(SIGNED.uploadUrl);
    expect([...body.keys()].sort()).toEqual([...Object.keys(SIGNED.params), "api_key", "signature", "file"].sort());
    for (const [key, value] of Object.entries(SIGNED.params)) expect(body.get(key)).toBe(value);
    expect(body.get("api_key")).toBe("key-123");
    expect(body.get("signature")).toBe("sig-abc");
    expect((body.get("file") as File).name).toBe("shirt.png");
  });

  it("confirms with the publicId from the sign response, never Cloudinary's", async () => {
    const { deps, post } = makeDeps();
    await runUpload(deps, "products", png());
    expect(post.mock.calls[1]?.[0]).toBe("/api/uploads/confirm");
    expect(post.mock.calls[1]?.[1]).toEqual({ kind: "products", publicId: PUBLIC_ID });
  });

  it("reports stages in order and forwards upload progress", async () => {
    const stages: string[] = [];
    const progress: number[] = [];
    const { deps } = makeDeps({
      xhrUpload: async (_url, _body, opts) => {
        opts.onProgress?.(40);
        opts.onProgress?.(100);
        return {};
      },
    });
    await runUpload(deps, "products", png(), { onStage: (s) => stages.push(s), onProgress: (p) => progress.push(p) });
    expect(stages).toEqual(["signing", "uploading", "confirming"]);
    expect(progress).toEqual([40, 100]);
  });

  it("fails the pre-check without any network call", async () => {
    for (const file of [png(0), png(5, "a.gif", "image/gif"), png(MAX_IMAGE_BYTES + 1)]) {
      const { deps, post, xhrUpload } = makeDeps();
      const outcome = await outcomeOf(runUpload(deps, "products", file));
      expect(outcome.kind).toBe("error");
      expect(post).not.toHaveBeenCalled();
      expect(xhrUpload).not.toHaveBeenCalled();
    }
  });

  describe("error mapping", () => {
    it("503 on sign -> not-configured", async () => {
      const { deps } = makeDeps({ post: async () => Promise.reject(apiError(503, "INTEGRATION_NOT_CONFIGURED")) });
      expect(await outcomeOf(runUpload(deps, "products", png()))).toEqual({ kind: "not-configured" });
    });
    it("403 -> permission message", async () => {
      const { deps } = makeDeps({ post: async () => Promise.reject(apiError(403, "FORBIDDEN")) });
      const outcome = await outcomeOf(runUpload(deps, "products", png()));
      expect(outcome).toEqual({ kind: "error", message: expect.stringMatching(/permission/i) });
    });
    it("429 -> too many uploads", async () => {
      const { deps } = makeDeps({ post: async () => Promise.reject(apiError(429, "RATE_LIMITED")) });
      expect(await outcomeOf(runUpload(deps, "products", png()))).toEqual({
        kind: "error",
        message: "Too many uploads, try again later",
      });
    });
    it("400 on sign -> a static message, not the server text", async () => {
      const { deps } = makeDeps({ post: async () => Promise.reject(apiError(400, "VALIDATION_ERROR")) });
      const outcome = await outcomeOf(runUpload(deps, "products", png()));
      expect(outcome.kind).toBe("error");
      expect(JSON.stringify(outcome)).not.toContain("server text");
    });
    it("a transport failure -> 'The upload failed. Try again.' and no confirm call", async () => {
      const { deps, post } = makeDeps({ xhrUpload: async () => Promise.reject(new Error("boom")) });
      expect(await outcomeOf(runUpload(deps, "products", png()))).toEqual({
        kind: "error",
        message: "The upload failed. Try again.",
      });
      expect(post).toHaveBeenCalledTimes(1);
    });
    it("400 on confirm -> unsupported or too large", async () => {
      const post = vi.fn(async (path: string) => {
        if (path === "/api/uploads/sign") return SIGNED as never;
        throw apiError(400, "VALIDATION_ERROR");
      });
      const { deps } = makeDeps({ post });
      expect(await outcomeOf(runUpload(deps, "products", png()))).toEqual({
        kind: "error",
        message: "This file isn't a supported image or is too large",
      });
    });
    it("429 on confirm -> too many uploads", async () => {
      const post = vi.fn(async (path: string) => {
        if (path === "/api/uploads/sign") return SIGNED as never;
        throw apiError(429);
      });
      const { deps } = makeDeps({ post });
      expect(await outcomeOf(runUpload(deps, "products", png()))).toEqual({
        kind: "error",
        message: "Too many uploads, try again later",
      });
    });
    it("a malformed confirm response -> a generic error", async () => {
      const post = vi.fn(async (path: string) => (path === "/api/uploads/sign" ? SIGNED : { nope: true }) as never);
      const { deps } = makeDeps({ post });
      expect((await outcomeOf(runUpload(deps, "products", png()))).kind).toBe("error");
    });
    it("an unexpected error -> a generic message, never the raw text", async () => {
      const { deps } = makeDeps({ post: async () => Promise.reject(new Error("secret internals")) });
      const outcome = await outcomeOf(runUpload(deps, "products", png()));
      expect(outcome.kind).toBe("error");
      expect(JSON.stringify(outcome)).not.toContain("secret");
    });
  });

  describe("abort", () => {
    const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });

    it("an AbortError from the transport -> aborted", async () => {
      const { deps } = makeDeps({ xhrUpload: async () => Promise.reject(abortError()) });
      expect(await outcomeOf(runUpload(deps, "products", png()))).toEqual({ kind: "aborted" });
    });
    it("an AbortError from sign -> aborted", async () => {
      const { deps } = makeDeps({ post: async () => Promise.reject(abortError()) });
      expect(await outcomeOf(runUpload(deps, "products", png()))).toEqual({ kind: "aborted" });
    });
    it("an already-aborted signal makes no network call", async () => {
      const { deps, post } = makeDeps();
      const controller = new AbortController();
      controller.abort();
      expect(await outcomeOf(runUpload(deps, "products", png(), { signal: controller.signal }))).toEqual({ kind: "aborted" });
      expect(post).not.toHaveBeenCalled();
    });
    it("aborting during the upload stops before confirm", async () => {
      const controller = new AbortController();
      const { deps, post } = makeDeps({
        xhrUpload: async () => {
          controller.abort();
          return {};
        },
      });
      expect(await outcomeOf(runUpload(deps, "products", png(), { signal: controller.signal }))).toEqual({ kind: "aborted" });
      expect(post).toHaveBeenCalledTimes(1);
    });
    it("passes the signal to sign, upload and confirm", async () => {
      const controller = new AbortController();
      const { deps, post, xhrUpload } = makeDeps();
      await runUpload(deps, "products", png(), { signal: controller.signal });
      expect(post.mock.calls[0]?.[2]).toBe(controller.signal);
      expect(post.mock.calls[1]?.[2]).toBe(controller.signal);
      expect(xhrUpload.mock.calls[0]?.[2].signal).toBe(controller.signal);
    });
  });
});
