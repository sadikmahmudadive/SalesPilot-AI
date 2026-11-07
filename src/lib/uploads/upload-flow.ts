/**
 * The browser-side upload sequence: pre-check, sign, upload straight to Cloudinary, confirm.
 * Pure of React and of the network (everything is injected), so it is unit tested directly.
 *
 * The multipart body contains EXACTLY the signed `params`, `api_key`, `signature` and `file`;
 * any other field would invalidate the signature. The `publicId` that is confirmed is the one the
 * server returned when signing, never anything from Cloudinary's answer. Failures become an
 * `UploadFlowError` carrying a typed outcome with a static, friendly message; server texts, URLs
 * and the signature are never put into messages or logs.
 */
import { ApiError } from "@/lib/api/client";
import { uploadPolicy, type UploadKind, type UploadPolicy } from "@/lib/cloudinary/folders";
import type { ConfirmedUpload, SignedUpload } from "@/schemas/upload";

export type UploadStage = "signing" | "uploading" | "confirming";

export type UploadOutcome =
  | { kind: "not-configured" }
  | { kind: "aborted" }
  | { kind: "error"; message: string };

export class UploadFlowError extends Error {
  readonly outcome: UploadOutcome;
  constructor(outcome: UploadOutcome) {
    super(outcome.kind === "error" ? outcome.message : outcome.kind);
    this.name = "UploadFlowError";
    this.outcome = outcome;
  }
}

export interface UploadDeps {
  /** JSON POST to our own API (`apiFetch`-like). Rejects with `ApiError`. */
  post: <T>(path: string, body: unknown, signal?: AbortSignal) => Promise<T>;
  /** Multipart POST to Cloudinary with progress and cancellation. */
  xhrUpload: (url: string, body: FormData, options: { onProgress?: (percent: number) => void; signal?: AbortSignal }) => Promise<unknown>;
  createFormData: () => FormData;
}

export interface RunUploadOptions {
  signal?: AbortSignal;
  onStage?: (stage: UploadStage) => void;
  /** Upload progress, 0-100. */
  onProgress?: (percent: number) => void;
}

export const MESSAGES = {
  empty: "This file is empty",
  unavailable: "Uploads of this type are not available yet",
  permission: "You do not have permission to upload files",
  rateLimited: "Too many uploads, try again later",
  uploadFailed: "The upload failed. Try again.",
  rejected: "This file isn't a supported image or is too large",
  signRejected: "This file can't be uploaded. Check its type and size.",
  generic: "Something went wrong. Please try again.",
} as const;

const FORMAT_LABELS: Readonly<Record<string, string>> = {
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "image/avif": "AVIF",
};

function listFormats(types: readonly string[]): string {
  const names = types.map((t) => FORMAT_LABELS[t] ?? t);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : (names[0] ?? "");
}

/** `null` when the upload policy of `kind` is not available (knowledge uploads for now). */
export function policyFor(kind: UploadKind): UploadPolicy | null {
  try {
    return uploadPolicy(kind);
  } catch {
    return null;
  }
}

/** UX-only check (the server enforces the real limits). Returns a message, or `null` when fine. */
export function precheckFile(kind: UploadKind, file: { size: number; type: string }): string | null {
  const policy = policyFor(kind);
  if (!policy) return MESSAGES.unavailable;
  if (file.size <= 0) return MESSAGES.empty;
  if (!policy.contentTypes.includes(file.type)) return `Use a ${listFormats(policy.contentTypes)} image`;
  if (file.size > policy.maxBytes) return `Images must be ${Math.floor(policy.maxBytes / (1024 * 1024))} MB or smaller`;
  return null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isAbort = (e: unknown): boolean => isRecord(e) && e.name === "AbortError";

function toOutcome(error: unknown, phase: "sign" | "upload" | "confirm"): UploadOutcome {
  if (error instanceof UploadFlowError) return error.outcome;
  if (isAbort(error)) return { kind: "aborted" };
  if (phase === "upload") return { kind: "error", message: MESSAGES.uploadFailed };
  if (error instanceof ApiError) {
    if (error.status === 503 || error.code === "INTEGRATION_NOT_CONFIGURED") return { kind: "not-configured" };
    if (error.status === 403) return { kind: "error", message: MESSAGES.permission };
    if (error.status === 429) return { kind: "error", message: MESSAGES.rateLimited };
    if (error.status === 400) {
      return { kind: "error", message: phase === "confirm" ? MESSAGES.rejected : MESSAGES.signRejected };
    }
    if (error.status === 0) return { kind: "error", message: error.message };
  }
  return { kind: "error", message: MESSAGES.generic };
}

function isSigned(value: unknown): value is SignedUpload {
  return (
    isRecord(value) &&
    typeof value.uploadUrl === "string" &&
    typeof value.publicId === "string" &&
    typeof value.apiKey === "string" &&
    typeof value.signature === "string" &&
    isRecord(value.params)
  );
}

function isConfirmed(value: unknown): value is ConfirmedUpload {
  return (
    isRecord(value) &&
    typeof value.url === "string" &&
    typeof value.publicId === "string" &&
    typeof value.width === "number" &&
    typeof value.height === "number"
  );
}

/** Builds the multipart body from exactly the signed fields plus the file. */
function buildBody(deps: UploadDeps, signed: SignedUpload, file: Blob): FormData {
  const body = deps.createFormData();
  for (const [key, value] of Object.entries(signed.params)) body.append(key, String(value));
  body.append("api_key", signed.apiKey);
  body.append("signature", signed.signature);
  body.append("file", file);
  return body;
}

async function step<T>(phase: "sign" | "upload" | "confirm", signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  if (signal?.aborted) throw new UploadFlowError({ kind: "aborted" });
  try {
    const result = await run();
    if (signal?.aborted) throw new UploadFlowError({ kind: "aborted" });
    return result;
  } catch (error) {
    throw new UploadFlowError(toOutcome(error, phase));
  }
}

/** Pre-check, sign, upload, confirm. Throws `UploadFlowError`; returns the confirmed image. */
export async function runUpload(
  deps: UploadDeps,
  kind: UploadKind,
  file: File,
  { signal, onStage, onProgress }: RunUploadOptions = {},
): Promise<ConfirmedUpload> {
  const problem = precheckFile(kind, file);
  if (problem) throw new UploadFlowError({ kind: "error", message: problem });

  onStage?.("signing");
  const signed = await step("sign", signal, async () => {
    const value = await deps.post<unknown>("/api/uploads/sign", { kind, contentType: file.type, bytes: file.size }, signal);
    if (!isSigned(value)) throw new Error("bad sign response");
    return value;
  });

  onStage?.("uploading");
  await step("upload", signal, () => deps.xhrUpload(signed.uploadUrl, buildBody(deps, signed, file), { onProgress, signal }));

  onStage?.("confirming");
  return step("confirm", signal, async () => {
    const value = await deps.post<unknown>("/api/uploads/confirm", { kind, publicId: signed.publicId }, signal);
    if (!isConfirmed(value)) throw new Error("bad confirm response");
    return value;
  });
}
