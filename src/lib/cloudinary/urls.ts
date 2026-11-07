/**
 * Display URLs for Cloudinary images. Pure and client-safe: no SDK, no env, no server imports.
 *
 * Transformations are inserted right after `/{cloud}/image/upload/`. Only https URLs on
 * res.cloudinary.com are touched; anything else is returned unchanged, as are invalid sizes.
 * A URL that already carries a transformation is returned unchanged (idempotent).
 */
const HOST = "res.cloudinary.com";
const UPLOAD = /^\/[A-Za-z0-9_-]+\/image\/upload\//;
const VERSION = /^v\d+$/;
// One or more comma-separated tokens such as c_fill,w_200,f_auto,q_auto.
const TRANSFORMATION = /^[a-z]{1,3}_[^,/]+(?:,[a-z]{1,3}_[^,/]+)*$/;
const MAX_DIMENSION = 4000;

function insert(raw: string, transformation: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (url.protocol !== "https:" || url.hostname !== HOST) return raw;
  if (url.port !== "" || url.username !== "" || url.password !== "") return raw;
  const marker = UPLOAD.exec(url.pathname);
  if (!marker) return raw;
  const head = marker[0];
  const tail = url.pathname.slice(head.length);
  const first = tail.split("/")[0] ?? "";
  // Public ids of this app start with "organizations/"; a first segment that is neither a version
  // nor that and looks like transformation tokens means one is already present.
  if (first !== "organizations" && !VERSION.test(first) && TRANSFORMATION.test(first)) return raw;
  return `${url.origin}${head}${transformation}/${tail}${url.search}${url.hash}`;
}

const validSize = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= MAX_DIMENSION;

/** A cropped (fill), auto-format, auto-quality copy of `url` at `w` x `h` (integers 1-4000). */
export function thumbUrl(url: string, w: number, h: number): string {
  if (!validSize(w) || !validSize(h)) return url;
  return insert(url, `c_fill,w_${w},h_${h},f_auto,q_auto`);
}

/** The original framing with auto format and quality. */
export function optimizedUrl(url: string): string {
  return insert(url, "f_auto,q_auto");
}
