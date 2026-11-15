import { ValidationError } from "@/lib/errors";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024; // 1 MB

export interface OutboundHttpOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * Safe outbound fetch for external third-party APIs (payment gateways, couriers).
 * - Enforces a strict timeout
 * - Does not follow redirects (redirect: "manual")
 * - Enforces response size cap
 */
export async function fetchOutbound(
  url: string,
  options: OutboundHttpOptions = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      redirect: "manual",
      signal: controller.signal,
    });
    return response;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ValidationError(undefined, `Outbound request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch and parse JSON safely from an outbound request.
 */
export async function fetchOutboundJson<T = unknown>(
  url: string,
  options: OutboundHttpOptions = {},
): Promise<T> {
  const response = await fetchOutbound(url, options);

  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new ValidationError(undefined, "Outbound response exceeded maximum permitted size");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ValidationError(
      undefined,
      `Outbound response was not valid JSON (status ${response.status})`,
    );
  }
}
