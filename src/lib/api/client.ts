/**
 * Browser-side helper for calling our own JSON API. Same-origin only; it never redirects (callers
 * decide what a 401 means for their screen).
 *
 * Every failure becomes an `ApiError`, except an aborted request, which is rethrown untouched so
 * callers and TanStack Query can recognise cancellation.
 */

export interface ApiErrorDetail {
  path: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly details: ApiErrorDetail[];

  constructor(init: { status: number; code: string; message: string; requestId?: string; details?: ApiErrorDetail[] }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.details = init.details ?? [];
  }
}

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function parseDetails(value: unknown): ApiErrorDetail[] {
  if (!Array.isArray(value)) return [];
  const out: ApiErrorDetail[] = [];
  for (const item of value) {
    if (isRecord(item) && typeof item.path === "string" && typeof item.message === "string") {
      out.push({ path: item.path, message: item.message });
    }
  }
  return out;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const payload = await readJson(res);
  const envelope = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
  const fallbackCode = res.status === 401 ? "UNAUTHENTICATED" : "HTTP_ERROR";
  return new ApiError({
    status: res.status,
    code: typeof envelope?.code === "string" ? envelope.code : fallbackCode,
    message: typeof envelope?.message === "string" ? envelope.message : GENERIC_MESSAGE,
    requestId: typeof envelope?.requestId === "string" ? envelope.requestId : undefined,
    details: parseDetails(envelope?.details),
  });
}

function isAbort(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { method = "GET", body, signal } = options;
  const hasBody = body !== undefined;

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError({
      status: 0,
      code: "NETWORK",
      message: "Could not reach the server. Check your connection and try again.",
    });
  }

  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;

  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError({ status: res.status, code: "BAD_RESPONSE", message: GENERIC_MESSAGE });
  }
}
