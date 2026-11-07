/**
 * Org-scoped Cloudinary access. Server-only.
 *
 * UPLOAD FLOW (client never holds a secret, never picks a path):
 *   1. `signUpload`   - the server generates the FULL public id
 *                       `organizations/{orgId}/{kind}/{24 lowercase hex}` (crypto.randomBytes) and
 *                       signs {public_id, timestamp, allowed_formats, overwrite, type}. Cloudinary
 *                       requires every posted parameter (except file, cloud_name, resource_type
 *                       and api_key) to be signed, so the client cannot change the public id,
 *                       flip `overwrite`, or add `folder` / `eager` / `notification_url` /
 *                       transformations. REPLAY: a signature is valid for about an hour and can be
 *                       posted repeatedly, but with `overwrite` off every post can only target
 *                       that one public id, so one signature yields at most one asset PER RESOURCE
 *                       TYPE (a replayed image post returns the existing asset instead of
 *                       creating another). Residue: the upload URL here is `/image/upload`, but
 *                       Cloudinary also accepts the same signed params at `/raw/upload` and
 *                       `/video/upload`, so a replay could create one extra raw or video asset
 *                       at the same public id; `confirmUpload` only accepts images, so such an
 *                       asset can never be confirmed or referenced. Quota exhaustion therefore
 *                       needs one sign request (rate limited) per asset, at most three assets
 *                       per request.
 *   2. The browser posts `params`, `api_key`, `signature` and `file` to `uploadUrl`.
 *   3. `confirmUpload` - the server fetches the asset through the Admin API and verifies it (size,
 *                       format, resource type, URL host and cloud). Cloudinary has no signed size
 *                       limit, so this is the real size gate: a violating asset is destroyed.
 *                       On success a record `uploads/{sha256(publicId)}` is written (records.ts);
 *                       the products service accepts only images that have one.
 *
 * `overwrite` is serialised as the SDK itself does (`utils.as_safe_bool(false)` is 0, posted and
 * signed as "0"). All signed values are STRINGS so the signed text and the form value are
 * byte-identical.
 *
 * ADMIN API QUOTA. Every `confirmUpload` costs one Admin API call, and Cloudinary rate-limits the
 * Admin API per ACCOUNT (an hourly allowance shared by every tenant). Routes therefore apply, on
 * top of the per-minute limit, per-user and per-org hourly quotas (quota.ts) before this module is
 * called, so one member cannot make confirm fail for all tenants.
 *
 * The SDK is configured lazily on each call from `getServerEnv()` (with `hide_sensitive`, so the
 * SDK's rejections do not carry the basic-auth credentials); nothing is read at import time.
 * The API secret never leaves this module: not in a return value, an error or a log line. Raw
 * Cloudinary errors can contain the request (`request_options.auth` = "key:secret") and the signed
 * URL, so only their numeric `http_code` (top level or under `error`) is ever logged.
 *
 * Unexpected Cloudinary failures throw a plain `Error('Cloudinary request failed')`, which the
 * API layer answers with the generic 500 envelope.
 */
import "server-only";
import { randomBytes } from "node:crypto";

import { v2 as cloudinary } from "cloudinary";

import { getServerEnv, isConfigured } from "@/config/env";
import { IntegrationNotConfiguredError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { invalid } from "@/lib/validation-error";
import { imageCloudName, urlMatchesPublicId } from "@/schemas/product";
import type { ConfirmedUpload, SignedUpload } from "@/schemas/upload";

import {
  assertOwnedPublicId,
  assertOwnedPublicIdOfKind,
  orgFolder,
  uploadPolicy,
  type UploadKind,
  type UploadPolicy,
} from "./folders";
import { deleteUploadRecord, saveUploadRecord } from "./records";

const CLOUD_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_DIMENSION = 20_000; // matches the product image schema
const GENERIC_FAILURE = "Cloudinary request failed";
/** `overwrite: false` exactly as the SDK serialises it (`as_safe_bool(false)` is 0). */
const OVERWRITE_OFF = "0";

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
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
    hide_sensitive: true,
  });
  return { cloudName, apiKey, apiSecret };
}

/**
 * The numeric HTTP status of a Cloudinary rejection, or undefined. Reads nothing else. The SDK
 * rejects with `{ request_options, query_params, error: { message, http_code } }` for API errors
 * and with `{ message, http_code }` for some transport errors; both are handled.
 */
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

/** A fresh public id: `organizations/{orgId}/{kind}/{24 lowercase hex}`. */
function newPublicId(orgId: string, kind: UploadKind): string {
  return `${orgFolder(orgId, kind)}/${randomBytes(12).toString("hex")}`;
}

/**
 * Signs ONE upload of a file of `kind` to a server-generated public id inside
 * `organizations/{orgId}/{kind}`. `file` is what the client claims; the content type and size are
 * checked against the kind's policy, but the real enforcement is `allowed_formats` at Cloudinary
 * plus `confirmUpload`.
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
  const publicId = newPublicId(orgId, kind);
  const { cloudName, apiKey, apiSecret } = credentials();

  const params: SignedUpload["params"] = {
    public_id: publicId,
    timestamp: String(Math.floor(Date.now() / 1000)),
    allowed_formats: policy.formats.join(","),
    overwrite: OVERWRITE_OFF,
    type: "upload",
  };
  const signature = cloudinary.utils.api_sign_request(params, apiSecret);
  return {
    cloudName,
    apiKey,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    publicId,
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

type AssetCheck =
  | { outcome: "ok"; image: ConfirmedUpload; bytes: number }
  /** The asset breaks the upload policy: destroy it and answer 400. */
  | { outcome: "violation" }
  /** The response does not fit this deployment (cloud, host, id): log, answer 500, keep the asset. */
  | { outcome: "unexpected"; reason: string };

function checkAsset(asset: unknown, publicId: string, policy: UploadPolicy, cloudName: string): AssetCheck {
  if (typeof asset !== "object" || asset === null) return { outcome: "unexpected", reason: "not_an_object" };
  const a = asset as Record<string, unknown>;
  const { bytes, format, width, height, secure_url: url } = a;
  if (a.resource_type !== "image") return { outcome: "violation" };
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > policy.maxBytes) {
    return { outcome: "violation" };
  }
  if (typeof format !== "string" || !policy.formats.includes(format)) return { outcome: "violation" };
  if (!isPositiveDimension(width) || !isPositiveDimension(height)) return { outcome: "violation" };
  // Deployment-level mismatches are not the uploader's doing: never destroy on these.
  if (a.public_id !== undefined && a.public_id !== publicId) {
    return { outcome: "unexpected", reason: "public_id_mismatch" };
  }
  // https on res.cloudinary.com, this deployment's cloud, and exactly this asset (the same rule
  // the product schema applies when the image is stored).
  if (typeof url !== "string" || imageCloudName(url) !== cloudName) {
    return { outcome: "unexpected", reason: "cloud_or_host_mismatch" };
  }
  if (!urlMatchesPublicId(url, publicId)) return { outcome: "unexpected", reason: "url_mismatch" };
  return { outcome: "ok", image: { url, publicId, width, height }, bytes };
}

/**
 * Verifies that `publicId` (owned by `orgId`, under `kind`) is an acceptable uploaded image,
 * records the confirmation and returns the shape products store.
 *   - An asset that breaks the size/format/type/dimension policy is destroyed and rejected with a
 *     static ValidationError (400).
 *   - A cloud or host mismatch is a deployment misconfiguration: logged, generic 500, the asset is
 *     NOT destroyed.
 *   - A kind that differs from the id's folder is a ForbiddenError; a Cloudinary 404 is a
 *     NotFoundError; any other Cloudinary failure is a generic 500.
 */
export async function confirmUpload(orgId: string, kind: UploadKind, publicId: string): Promise<ConfirmedUpload> {
  assertOwnedPublicIdOfKind(orgId, kind, publicId);
  const policy = uploadPolicy(kind);
  const { cloudName } = credentials();

  let asset: unknown;
  try {
    asset = await cloudinary.api.resource(publicId, { resource_type: "image" });
  } catch (error) {
    if (httpCodeOf(error) === 404) throw new NotFoundError("Uploaded file not found");
    throw failure("resource", error);
  }

  const check = checkAsset(asset, publicId, policy, cloudName);
  if (check.outcome === "violation") {
    await destroyQuietly(publicId);
    throw new ValidationError([{ path: "publicId", message: "The uploaded file is not allowed" }], "Upload rejected");
  }
  if (check.outcome === "unexpected") {
    logger.error("cloudinary_asset_unexpected", { reason: check.reason });
    throw new Error(GENERIC_FAILURE);
  }
  await saveUploadRecord({ organizationId: orgId, kind, ...check.image, bytes: check.bytes });
  return check.image;
}

/**
 * Deletes an owned asset and its confirmation record. The record goes first, so a failed destroy
 * leaves an orphaned asset that no product can reference, and a retry finishes the job.
 * Idempotent: an asset that is already gone is success. This does NOT check whether a product
 * still references the image; callers remove it from the product first.
 */
export async function deleteAsset(orgId: string, publicId: string): Promise<void> {
  assertOwnedPublicId(orgId, publicId);
  credentials();
  await deleteUploadRecord(publicId);
  let result: unknown;
  try {
    result = await cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true });
  } catch (error) {
    if (httpCodeOf(error) === 404) return;
    throw failure("destroy", error);
  }
  const outcome = typeof result === "object" && result !== null ? (result as { result?: unknown }).result : undefined;
  if (outcome === "ok" || outcome === "not found") return;
  logger.error("cloudinary_request_failed", {
    op: "destroy",
    result: typeof outcome === "string" ? outcome : undefined,
  });
  throw new Error(GENERIC_FAILURE);
}
