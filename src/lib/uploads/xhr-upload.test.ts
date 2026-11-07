import { describe, expect, it, vi } from "vitest";

import { UploadTransportError, xhrUpload, type XhrLike } from "./xhr-upload";

type ProgressEvent = { lengthComputable: boolean; loaded: number; total: number };

class FakeXhr implements XhrLike {
  static last: FakeXhr;
  method = "";
  url = "";
  body: unknown;
  timeout = 0;
  withCredentials = true;
  status = 0;
  responseText = "";
  aborted = false;
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

const start = (opts: Partial<Parameters<typeof xhrUpload>[2]> = {}) => {
  const body = new FormData();
  const promise = xhrUpload("https://api.cloudinary.com/v1_1/demo/image/upload", body, {
    createXhr: () => new FakeXhr(),
    ...opts,
  });
  return { promise, xhr: FakeXhr.last, body };
};

describe("xhrUpload", () => {
  it("POSTs the body to the url without credentials and with a timeout", () => {
    const { xhr, body } = start();
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("https://api.cloudinary.com/v1_1/demo/image/upload");
    expect(xhr.body).toBe(body);
    expect(xhr.withCredentials).toBe(false);
    expect(xhr.timeout).toBe(120_000);
  });

  it("reports progress as whole percentages and ignores non-computable events", () => {
    const onProgress = vi.fn();
    const { xhr } = start({ onProgress });
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 5, total: 0 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 3 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 3, total: 3 });
    expect(onProgress.mock.calls).toEqual([[33], [100]]);
  });

  it("resolves with the parsed JSON on 2xx", async () => {
    const { promise, xhr } = start();
    xhr.status = 200;
    xhr.responseText = '{"public_id":"x"}';
    xhr.onload?.();
    await expect(promise).resolves.toEqual({ public_id: "x" });
  });

  it("rejects a 2xx whose body is not JSON", async () => {
    const { promise, xhr } = start();
    xhr.status = 200;
    xhr.responseText = "<html>";
    xhr.onload?.();
    await expect(promise).rejects.toBeInstanceOf(UploadTransportError);
  });

  it("rejects on a non-2xx status without exposing the body", async () => {
    const { promise, xhr } = start();
    xhr.status = 401;
    xhr.responseText = '{"error":{"message":"Invalid Signature secret"}}';
    xhr.onload?.();
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UploadTransportError);
    expect(error).toMatchObject({ reason: "http", status: 401 });
    expect((error as Error).message).not.toContain("secret");
  });

  it("rejects on a network error", async () => {
    const { promise, xhr } = start();
    xhr.onerror?.();
    await expect(promise).rejects.toMatchObject({ reason: "network" });
  });

  it("rejects on a timeout", async () => {
    const { promise, xhr } = start();
    xhr.ontimeout?.();
    await expect(promise).rejects.toMatchObject({ reason: "timeout" });
  });

  it("aborts the request when the signal fires and rejects with an AbortError", async () => {
    const controller = new AbortController();
    const { promise, xhr } = start({ signal: controller.signal });
    controller.abort();
    expect(xhr.aborted).toBe(true);
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects without sending when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const createXhr = vi.fn(() => new FakeXhr());
    const { promise } = start({ signal: controller.signal, createXhr });
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(createXhr).not.toHaveBeenCalled();
  });

  it("stops listening to the signal once settled", async () => {
    const controller = new AbortController();
    const { promise, xhr } = start({ signal: controller.signal });
    xhr.status = 200;
    xhr.responseText = "{}";
    xhr.onload?.();
    await promise;
    controller.abort();
    expect(xhr.aborted).toBe(false);
  });
});
