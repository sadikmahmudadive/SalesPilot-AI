"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import { LiveStatus, useAnnouncer } from "@/components/shared/live-status";
import { MediaUploader } from "@/components/uploads/media-uploader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { thumbUrl } from "@/lib/cloudinary/urls";
import { focusAfterRemove } from "@/lib/uploads/focus-after-remove";
import type { Role } from "@/lib/security/permissions";
import { MAX_IMAGES, type ProductImage } from "@/schemas/product";
import type { ConfirmedUpload } from "@/schemas/upload";

const THUMB_PX = 96;

interface ImageGalleryProps {
  images: readonly ProductImage[];
  productName: string;
  role: Role;
  /** Anyone without write access sees the images only: no remove buttons, no uploader. */
  canWrite: boolean;
  /** True while the product is being saved. */
  disabled?: boolean;
  onUploaded: (image: ConfirmedUpload) => void;
  /** Removes the image at `index` from the form (the stored file is cleaned up after the save). */
  onRemove: (index: number) => void;
  /** Passed through from the uploader: true while a file is queued, uploading or confirming. */
  onBusyChange?: (busy: boolean) => void;
}

/**
 * The product's images (the first one is the primary image) with a remove button each, and the
 * uploader. Removing only changes the form; nothing is deleted from media storage until the
 * product is saved (see `useImageCleanup`).
 */
export function ImageGallery({
  images,
  productName,
  role,
  canWrite,
  disabled = false,
  onUploaded,
  onRemove,
  onBusyChange,
}: ImageGalleryProps) {
  const { message, announce } = useAnnouncer();
  const list = useRef<HTMLUListElement>(null);
  const uploaderInput = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // Set by a removal; the effect below applies it once the list has re-rendered without the image.
  const pendingFocus = useRef<number | "uploader" | null>(null);

  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    const button =
      typeof target === "number"
        ? list.current?.querySelectorAll<HTMLButtonElement>("button")[target]
        : undefined;
    (button ?? uploaderInput.current ?? root.current)?.focus();
  }, [images]);

  const label = productName || "Product";

  return (
    <div ref={root} tabIndex={-1} className="space-y-4 outline-none">
      {images.length > 0 ? (
        <ul ref={list} className="flex flex-wrap gap-3" aria-label="Product images">
          {images.map((image, index) => (
            <li
              key={image.publicId}
              className="relative size-24 overflow-hidden rounded-md border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary already delivers a resized copy */}
              <img
                src={thumbUrl(image.url, 160, 160)}
                alt={`${label}, image ${index + 1}`}
                width={THUMB_PX}
                height={THUMB_PX}
                loading="lazy"
                decoding="async"
                className="size-full object-cover"
              />
              {index === 0 ? (
                <Badge variant="secondary" className="absolute bottom-1 left-1">
                  Primary
                </Badge>
              ) : null}
              {canWrite ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-xs"
                  className="absolute top-1 right-1"
                  disabled={disabled}
                  aria-label={`Remove image ${index + 1}`}
                  onClick={() => {
                    pendingFocus.current = focusAfterRemove(images.length, index);
                    onRemove(index);
                    announce(`Image ${index + 1} removed. Save to keep this change.`);
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {canWrite ? "No images yet." : "This product has no images."}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {images.length} of {MAX_IMAGES} images
        {images.length > 0 ? ". The first image is the primary one shown in lists." : "."}
      </p>
      {canWrite ? (
        <MediaUploader
          kind="products"
          role={role}
          maxFiles={MAX_IMAGES}
          currentCount={images.length}
          onUploaded={onUploaded}
          disabled={disabled}
          onBusyChange={onBusyChange}
          ref={uploaderInput}
        />
      ) : null}
      <LiveStatus message={message} />
    </div>
  );
}
