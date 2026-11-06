"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";

import { thumbnailUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";

interface ProductThumbProps {
  name: string;
  /** URL of the product's first image, if it has one. */
  src?: string;
  /** Edge length in px (the thumbnail is square). */
  size?: number;
  className?: string;
}

/**
 * Square product thumbnail. Images come from Cloudinary (allowed by the CSP), so a plain lazy
 * `<img>` is enough; without an image, or if it fails to load, a neutral icon is shown.
 */
export function ProductThumb({ name, src, size = 40, className }: ProductThumbProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const box = cn("flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted", className);

  if (!src || failedSrc === src) {
    return (
      <span className={box} style={{ width: size, height: size }} role="img" aria-label={`No image for ${name}`}>
        <ImageIcon className="size-1/2 text-muted-foreground" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={box} style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary already delivers a resized copy */}
      <img
        src={thumbnailUrl(src, size * 2)}
        alt={`Photo of ${name}`}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className="size-full object-cover"
        onError={() => setFailedSrc(src)}
      />
    </span>
  );
}
