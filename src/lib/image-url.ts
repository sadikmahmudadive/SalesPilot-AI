/**
 * Display URLs for product images. Pure.
 *
 * Stored image URLs are Cloudinary delivery URLs without transformations (the schema requires
 * that). For lists and previews a small cropped copy is requested instead of the original.
 */
import { IMAGE_HOST } from "@/schemas/product";

const UPLOAD_SEGMENT = "/image/upload/";

/** A square, auto-format copy of a Cloudinary image; any other URL is returned unchanged. */
export function thumbnailUrl(raw: string, size: number): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (url.protocol !== "https:" || url.hostname !== IMAGE_HOST) return raw;
  const at = url.pathname.indexOf(UPLOAD_SEGMENT);
  if (at < 0) return raw;
  const px = Math.min(1600, Math.max(16, Math.round(size)));
  const head = url.pathname.slice(0, at + UPLOAD_SEGMENT.length);
  const tail = url.pathname.slice(at + UPLOAD_SEGMENT.length);
  return `${url.origin}${head}c_fill,w_${px},h_${px},f_auto,q_auto/${tail}${url.search}`;
}
