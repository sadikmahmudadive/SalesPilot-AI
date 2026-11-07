/**
 * Confirmed-upload records. Server-only.
 *
 * `uploads/{sha256(publicId)}` is written by `confirmUpload` once the Admin API has verified an
 * asset, and removed by `deleteAsset`. It is the proof that an image went through the upload
 * policy: the products service refuses any image that has no record of the SAME organization
 * and kind, and takes `url`, `width` and `height` from the record, never from the client.
 *
 * The collection is server-only: Firestore rules deny every client read and write (Admin SDK
 * only), and the document id is a hash so a public id cannot be probed through the id space.
 */
import "server-only";
import { createHash } from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { isAlreadyExists } from "@/lib/firestore-errors";

import type { UploadKind } from "./folders";

export const UPLOADS_COLLECTION = "uploads";

export interface UploadRecord {
  organizationId: string;
  kind: UploadKind;
  publicId: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
}

export function uploadRecordId(publicId: string): string {
  return createHash("sha256").update(publicId).digest("hex");
}

export function uploadRecordRef(publicId: string) {
  return adminDb().collection(UPLOADS_COLLECTION).doc(uploadRecordId(publicId));
}

/**
 * Records a confirmed upload. Idempotent: re-confirming the same public id keeps the first record
 * (the asset cannot change, `overwrite` is off), so `confirmedAt` is the first confirmation.
 */
export async function saveUploadRecord(record: UploadRecord): Promise<void> {
  try {
    await uploadRecordRef(record.publicId).create({
      ...record,
      confirmedAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }
}

/** Removes the record (no error when there is none). */
export async function deleteUploadRecord(publicId: string): Promise<void> {
  await uploadRecordRef(publicId).delete();
}
