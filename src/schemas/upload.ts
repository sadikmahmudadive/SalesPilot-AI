/**
 * Upload request schemas. Pure (client-safe).
 *
 * Object schemas strip unknown keys, so a client-supplied `folder`, `public_id`, `overwrite` or
 * `organizationId` is dropped here and can never reach the signing code. Size and type limits are
 * policy per kind and are enforced by `signUpload`, not here.
 */
import { z } from "zod";

import { UPLOAD_KINDS } from "@/lib/cloudinary/folders";

const kind = z.enum(UPLOAD_KINDS, { error: "Choose a valid upload type" });
const publicId = z
  .string({ error: "Invalid file reference" })
  .min(1, { error: "Invalid file reference" })
  .max(512, { error: "Invalid file reference" });

export const signUploadSchema = z.object({
  kind,
  contentType: z.string({ error: "Invalid file type" }).min(1).max(100, { error: "Invalid file type" }),
  bytes: z.number({ error: "Invalid file size" }).int({ error: "Invalid file size" }).min(1, { error: "Invalid file size" }),
});
export type SignUploadInput = z.output<typeof signUploadSchema>;

export const confirmUploadSchema = z.object({ kind, publicId });
export type ConfirmUploadInput = z.output<typeof confirmUploadSchema>;

export const deleteUploadSchema = z.object({ publicId });
export type DeleteUploadInput = z.output<typeof deleteUploadSchema>;

/** What `POST /api/uploads/sign` returns; the client posts exactly `params`, `api_key`, `signature` and `file`. */
export interface SignedUpload {
  cloudName: string;
  apiKey: string;
  uploadUrl: string;
  params: {
    folder: string;
    timestamp: string;
    allowed_formats: string;
    overwrite: "false";
    unique_filename: "true";
    use_filename: "false";
    type: "upload";
  };
  signature: string;
  maxBytes: number;
}

/** What `POST /api/uploads/confirm` returns; the shape product images are stored in. */
export interface ConfirmedUpload {
  url: string;
  publicId: string;
  width: number;
  height: number;
}
