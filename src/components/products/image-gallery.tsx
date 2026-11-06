import { ImageOff, Upload } from "lucide-react";

import { ProductThumb } from "@/components/products/product-thumb";
import { Button } from "@/components/ui/button";
import type { ProductImage } from "@/schemas/product";

interface ImageGalleryProps {
  images: readonly ProductImage[];
  productName: string;
}

/**
 * Images panel. Uploading is not available yet (the media uploader arrives with the media
 * storage setup), so the panel says so plainly and shows any images the product already has,
 * read-only. Saving the product leaves its images untouched.
 */
export function ImageGallery({ images, productName }: ImageGalleryProps) {
  return (
    <div className="space-y-4">
      {images.length > 0 ? (
        <ul className="flex flex-wrap gap-3" aria-label="Product images">
          {images.map((image, index) => (
            <li key={image.publicId}>
              <ProductThumb name={`${productName || "product"} (image ${index + 1})`} src={image.url} size={96} />
            </li>
          ))}
        </ul>
      ) : null}
      <div
        role="group"
        aria-label="Image upload"
        className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center"
      >
        <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <ImageOff className="size-5" aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-medium">Media storage not configured</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Image uploads will be available once media storage is set up. Existing images stay as they are.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled>
          <Upload aria-hidden="true" />
          Upload images
        </Button>
      </div>
    </div>
  );
}
