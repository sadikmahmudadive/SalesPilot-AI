/**
 * Browser transport for the direct-to-Cloudinary upload. `fetch` has no upload progress, so this
 * uses XMLHttpRequest. Cross-origin and unauthenticated: no cookies are sent (`withCredentials`
 * is false). Pure of React; the XHR constructor can be injected for tests.
 *
 * Failures never expose the response body (it can echo request details).
 */

/** The slice of XMLHttpRequest this module uses. */
export interface XhrLike {
  timeout: number;
  withCredentials: boolean;
  status: number;
  responseText: string;
  upload: {
    onprogress:
      ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
  };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  ontimeout: (() => void) | null;
  open(method: string, url: string): void;
  send(body: FormData): void;
  abort(): void;
}

export interface XhrUploadOptions {
  /** Whole-number percentage, 0-100. */
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  /** Milliseconds; defaults to 120 s. */
  timeoutMs?: number;
  /** For tests. */
  createXhr?: () => XhrLike;
}

export const UPLOAD_TIMEOUT_MS = 120_000;

export class UploadTransportError extends Error {
  readonly reason: "http" | "network" | "timeout" | "bad-response";
  readonly status: number;
  constructor(reason: UploadTransportError["reason"], status = 0) {
    super(`Upload transport failed (${reason})`);
    this.name = "UploadTransportError";
    this.reason = reason;
    this.status = status;
  }
}

const abortError = () =>
  Object.assign(new Error("The upload was cancelled"), { name: "AbortError" });

/** POSTs `body` to `url`; resolves with the parsed JSON of a 2xx answer and rejects otherwise. */
export function xhrUpload(
  url: string,
  body: FormData,
  options: XhrUploadOptions = {},
): Promise<unknown> {
  const {
    onProgress,
    signal,
    timeoutMs = UPLOAD_TIMEOUT_MS,
    createXhr = () => new XMLHttpRequest() as XhrLike,
  } = options;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());

    const xhr = createXhr();
    const onAbortSignal = () => xhr.abort();
    const settle = (finish: () => void) => {
      signal?.removeEventListener("abort", onAbortSignal);
      finish();
    };

    xhr.withCredentials = false;
    xhr.timeout = timeoutMs;
    xhr.open("POST", url);
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress?.(Math.min(100, Math.floor((event.loaded / event.total) * 100)));
    };
    xhr.onload = () =>
      settle(() => {
        if (xhr.status < 200 || xhr.status >= 300)
          return reject(new UploadTransportError("http", xhr.status));
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new UploadTransportError("bad-response", xhr.status));
        }
      });
    xhr.onerror = () => settle(() => reject(new UploadTransportError("network")));
    xhr.ontimeout = () => settle(() => reject(new UploadTransportError("timeout")));
    xhr.onabort = () => settle(() => reject(abortError()));

    signal?.addEventListener("abort", onAbortSignal, { once: true });
    xhr.send(body);
  });
}
