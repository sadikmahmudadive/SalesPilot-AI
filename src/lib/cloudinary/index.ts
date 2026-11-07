/**
 * Org-scoped Cloudinary access. Server-only.
 *
 * UPLOAD FLOW (client never holds a secret, never picks a path):
 *   1. `signUpload`   - server signs {folder, timestamp, allowed_formats, overwrite, unique_filename,
 *                       use_filename, type}. Cloudinary requires every posted parameter (except
 *                       file, cloud_name, resource_type and api_key) to be signed, so the client
 *                       cannot add a `public_id`, flip `overwrite`, change the folder or add
 *                       `eager` / `notification_url` / transformations. The folder is derived from
 *                       the membership's organization id; the public id is random
 *                       (`unique_filename` true, `use_filename` false).
 *   2. The browser posts `params`, `api_key`, `signature` and `file` to `uploadUrl`.
 *   3. `confirmUpload` - server fetches the asset through the Admin API and verifies it (size,
 *                       format, resource type, URL host and cloud). Cloudinary has no signed
 *                       size limit, so this is the real size gate: a violating asset is destroyed.
 *
 * All signed values are STRINGS ("false", "true", the timestamp) so the signature string and the
 * multipart form value are byte-identical (a boolean would be sent as "false" by FormData anyway,
 * but strings leave no doubt).
 *
 * The SDK is configured lazily on each call from `getServerEnv()`; nothing is read at import time.
 * The API secret never leaves this module: not in a return value, an error or a log line. Raw
 * Cloudinary errors can contain the request URL (api key, signature), so only their numeric
 * `http_code` is ever logged.
 *
 * Unexpected Cloudinary failures throw a plain `Error('Cloudinary request failed')`, which the
 * API layer answers with the generic 500 envelope.
 */
import "server-only";
import { v2 as cloudinary } from "cloudinary";

import { getServerEnv, isConfigured } from "@/config/env";
import { ForbiddenError, IntegrationNotConfiguredError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { imageCloudName, urlMatchesPublicId } from "@/schemas/product";
import type { ConfirmedUpload, SignedUpload } from "@/schemas/upload";
import { invalid } from "@/lib/validation-error";

import { assertOwnedPublicId, orgFolder, uploadPolicy, type UploadKind, type UploadPolicy } from "./folders";

const CLOUD_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_DIMENSION = 20_000; // matches the product image schema
const GENERIC_FAILURE = "Cloudinary request failed";

interface Credentials {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

/** Throws IntegrationNotConfiguredError (503) unless all three Cloudinary variables are set. */
export function assertCloudinaryConfigured(): void {
  if (!isConfigured("cloudinary")) throw new IntegrationNotConfiguredError("cloudinary");
}

function credentials(): Credentials {
  assertCloudinaryConfigured();
  const env = getServerEnv();
  const cloudName = env.CLOUDINARY_CLOUD_NAME as string;
  // A cloud name that is not a plain token cannot be trusted in a URL: treat it as misconfigured.
  if (!CLOUD_NAME_PATTERN.test(cloudName)) throw new IntegrationNotConfiguredError("cloudinary");
  const apiKey = env.CLOUDINARY_API_KEY as string;
  const apiSecret = env.CLOUDINARY_API_SECRET as string;
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  return { cloudName, apiKey, apiSecret };
}

/** The numeric HTTP status of a Cloudinary rejection, or undefined. Reads nothing else. */
function httpCodeOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const direct = (error as { http_code?: unknown }).http_code;
  if (typeof direct === "number") return direct;
  const nested = (error as { error?: { http_code?: unknown } }).error?.http_code;
  return typeof nested === "number" ? nested : undefined;
}

function failure(op: string, error: unknown): Error {
  logger.error("cloudinary_request_failed", { op, httpCode: httpCodeOf(error) });
  return new Error(GENERIC_FAILURE);
}

/**
 * Signs an upload of one file of `kind` into `organizations/{orgId}/{kind}`. `file` is what the
 * client claims; the content type and size are checked against the kind's policy, but the real
 * enforcement is `allowed_formats` at Cloudinary plus `confirmUpload`.
 */
export function signUpload(
  orgId: string,
  kind: UploadKind,
  file: { contentType: string; bytes: number },
): SignedUpload {
  const policy = uploadPolicy(kind);
  if (!policy.contentTypes.includes(file.contentType)) throw invalid("contentType", "This file type is not allowed");
  if (!Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > policy.maxBytes) {
    throw invalid("bytes", "The file must be at most 5 MB");
  }
  const folder = orgFolder(orgId, kind);
  const { cloudName, apiKey, apiSecret } = credentials();

  const params: SignedUpload["params"] = {
    folder,
    timestamp: String(Math.floor(Date.now() / 1000)),
    allowed_formats: policy.formats.join(","),
    overwrite: "false",
    unique_filename: "true",
    use_filename: "false",
    type: "upload",
  };
  const signature = cloudinary.utils.api_sign_request(params, apiSecret);
  return {
    cloudName,
    apiKey,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    params,
    signature,
    maxBytes: policy.maxBytes,
  };
}

/** Best effort: a failed cleanup is logged (code only) and never masks the original rejection. */
async function destroyQuietly(publicId: string): Promise<void> {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true });
  } catch (error) {
    logger.error("cloudinary_cleanup_failed", { httpCode: httpCodeOf(error) });
  }
}

const isPositiveDimension = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_DIMENSION;

/** The stored image shape when the Cloudinary resource satisfies the policy, otherwise null. */
function readAcceptableAsset(
  asset: unknown,
  publicId: string,
  policy: UploadPolicy,
  cloudName: string,
): ConfirmedUpload | null {
  if (typeof asset !== "object" || asset === null) return null;
  const a = asset as Record<string, unknown>;
  const { bytes, format, width, height, secure_url: url } = a;
  if (a.resource_type !== "image") return null;
  if (a.public_id !== undefined && a.public_id !== publicId) return null;
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > policy.maxBytes) return null;
  if (typeof format !== "string" || !policy.formats.includes(format)) return null;
  if (!isPositiveDimension(width) || !isPositiveDimension(height)) return null;
  // https on res.cloudinary.com, this deployment's cloud, and exactly this asset (the same rule
  // the product schema applies when the image is stored).
  if (typeof url !== "string" || imageCloudName(url) !== cloudName || !urlMatchesPublicId(url, publicId)) return null;
  return { url, publicId, width, height };
}

/**
 * Verifies that `publicId` (owned by `orgId`, under `kind`) is an acceptable uploaded image and
 * returns the shape products store. An asset that breaks the policy is destroyed and rejected with
 * a static ValidationError. A kind that differs from the id's folder is a ForbiddenError.
 * A Cloudinary 404 is a NotFoundError; any other Cloudinary failure is a generic 500.
 */
export async function confirmUpload(orgId: string, kind: UploadKind, publicId: string): Promise<ConfirmedUpload> {
  const idKind = assertOwnedPublicId(orgId, publicId);
  if (idKind !== kind) throw new ForbiddenError();
  const policy = uploadPolicy(kind);
  const { cloudName } = credentials();

  let asset: Record<string, unknown>;
  try {
    asset = (await cloudinary.api.resource(publicId, { resource_type: "image" })) as Record<string, unknown>;
  } catch (error) {
    if (httpCodeOf(error) === 404) throw new NotFoundError("Uploaded file not found");
    throw failure("resource", error);
  }

  const image = readAcceptableAsset(asset, publicId, policy, cloudName);
  if (!image) {
    await destroyQuietly(publicId);
    throw new ValidationError([{ path: "publicId", message: "The uploaded file is not allowed" }], "Upload rejected");
  }
  return image;
}

/**
 * Deletes an owned asset. Idempotent: an asset that is already gone is success. This does NOT
 * check whether a product still references the image; callers remove it from the product first.
 */
export async function deleteAsset(orgId: string, publicId: string): Promise<void> {
  assertOwnedPublicId(orgId, publicId);
  credentials();
  let result: unknown;
  try {
    result = await cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true });
  } catch (error) {
    if (httpCodeOf(error) === 404) return;
    throw failure("destroy", error);
  }
  const outcome = typeof result === "object" && result !== null ? (result as { result?: unknown }).result : undefined;
  if (outcome === "ok" || outcome === "not found") return;
  logger.error("cloudinary_request_failed", { op: "destroy", result: typeof outcome === "string" ? outcome : undefined });
  throw new Error(GENERIC_FAILURE);
}
