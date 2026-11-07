/**
 * Cloudinary folder layout, upload policy and ownership checks. Pure (no server-only, no SDK), so
 * it can be unit-tested and imported by client-safe schemas.
 *
 * Every asset lives under `organizations/{orgId}/{kind}/...`. The organization id always comes
 * from the membership context, never from a request, and a public id is only ever trusted after
 * `assertOwnedPublicId` has matched it against that folder.
 *
 * Source hygiene: no literal non-ASCII characters in this file.
 */
import { ForbiddenError } from "@/lib/errors";
import { isValidIdSegment } from "@/lib/ids";
import type { Permission } from "@/lib/security/permissions";
import { invalid } from "@/lib/validation-error";

export const UPLOAD_KINDS = ["products", "customers", "knowledge", "campaigns"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export const MAX_IMAGE_BYTES = 5_242_880; // 5 MB

export interface UploadPolicy {
  /** Accepted `Content-Type` values the client may declare. */
  readonly contentTypes: readonly string[];
  /** Cloudinary formats (signed as `allowed_formats`, re-checked on confirm). JPEG is "jpg". */
  readonly formats: readonly string[];
  readonly maxBytes: number;
}

const IMAGE_POLICY: UploadPolicy = {
  contentTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
  formats: ["jpg", "png", "webp", "avif"],
  maxBytes: MAX_IMAGE_BYTES,
};

/**
 * `null` = not available. Knowledge uploads are PDFs/documents, which Cloudinary stores with
 * `resource_type: raw`; the image-only signing/confirm flow below does not cover that. They are
 * rejected until Phase 3 adds a separate raw flow.
 */
const POLICIES: Readonly<Record<UploadKind, UploadPolicy | null>> = {
  products: IMAGE_POLICY,
  customers: IMAGE_POLICY,
  campaigns: IMAGE_POLICY,
  knowledge: null,
};

/** The policy for `kind`; knowledge throws a static ValidationError. */
export function uploadPolicy(kind: UploadKind): UploadPolicy {
  const policy = POLICIES[kind];
  if (!policy) throw invalid("kind", "Knowledge uploads are not available yet", "Knowledge uploads are not available yet");
  return policy;
}

const PERMISSIONS: Readonly<Record<UploadKind, Permission>> = {
  products: "uploads:products",
  customers: "uploads:customers",
  knowledge: "uploads:org",
  campaigns: "uploads:org",
};

export function kindPermission(kind: UploadKind): Permission {
  return PERMISSIONS[kind];
}

/** One path segment: starts with [A-Za-z0-9_-] (so never "." / ".."), then letters, digits, _ - . */
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
const MAX_PUBLIC_ID_LENGTH = 512;

/** `organizations/{orgId}/{kind}`. Throws (a programming error) for an org id that is not one safe segment. */
export function orgFolder(orgId: string, kind: UploadKind): string {
  if (!isValidIdSegment(orgId) || !SEGMENT.test(orgId)) throw new Error("Invalid organization id for an upload folder");
  return `organizations/${orgId}/${kind}`;
}

const KIND_SET: ReadonlySet<string> = new Set(UPLOAD_KINDS);

/**
 * Proves `publicId` is `organizations/{orgId}/{kind}/<path>` for exactly this organization and
 * returns the kind. Every path segment must match `SEGMENT` (no empty segments, `.`/`..`,
 * backslashes, percent-encoding, spaces or control characters), the id is at most 512 characters,
 * and the organization segment is compared whole so "AB" never matches "A".
 * Failure is a `ForbiddenError` with a static message: the id is never echoed.
 */
export function assertOwnedPublicId(orgId: string, publicId: string): UploadKind {
  if (typeof publicId !== "string" || publicId.length === 0 || publicId.length > MAX_PUBLIC_ID_LENGTH) {
    throw new ForbiddenError();
  }
  const segments = publicId.split("/");
  if (segments.length < 4) throw new ForbiddenError();
  if (!segments.every((s) => SEGMENT.test(s))) throw new ForbiddenError();
  const [root, org, kind] = segments;
  if (root !== "organizations" || org !== orgId || kind === undefined || !KIND_SET.has(kind)) {
    throw new ForbiddenError();
  }
  return kind as UploadKind;
}
