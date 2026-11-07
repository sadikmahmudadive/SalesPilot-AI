/**
 * Integration-test helper: writes a confirmed-upload record (what `confirmUpload` stores) so a
 * product can reference the image. Admin SDK, emulator only.
 */
import { FieldValue } from "firebase-admin/firestore";

import { uploadRecordRef } from "@/lib/cloudinary/records";

export interface SeedImage {
  url: string;
  publicId: string;
  width: number;
  height: number;
}

/** Records `image` as confirmed for `orgId` (kind products unless overridden). Returns the image. */
export async function seedUpload<T extends SeedImage>(
  orgId: string,
  image: T,
  over: Record<string, unknown> = {},
): Promise<T> {
  await uploadRecordRef(image.publicId).set({
    organizationId: orgId,
    kind: "products",
    publicId: image.publicId,
    url: image.url,
    width: image.width,
    height: image.height,
    bytes: 1000,
    confirmedAt: FieldValue.serverTimestamp(),
    ...over,
  });
  return image;
}
