"use client";

import { useCallback, useRef } from "react";

import { ApiError, apiFetch } from "@/lib/api/client";
import { plannedDeletes } from "@/lib/uploads/planned-deletes";

/**
 * Best-effort removal of an uploaded asset (the server call is idempotent). Never blocks the UI and
 * never surfaces an error: a failed delete only leaves an orphaned asset. It is logged to the
 * console in development only, and without anything but the status.
 */
function deleteAssetQuietly(publicId: string): void {
  apiFetch("/api/uploads/delete", { method: "POST", body: { publicId } }).catch((error: unknown) => {
    if (process.env.NODE_ENV === "development") {
      console.warn("Could not delete an uploaded image", error instanceof ApiError ? error.status : "network");
    }
  });
}

/**
 * Decides when images the editor no longer wants are deleted from media storage (see
 * `plannedDeletes`): an image nothing saved refers to goes at once; an image the saved product
 * refers to goes only after a save that dropped it. Discarding the form leaves the session's
 * uploads as confirmed orphans; a cleanup job for those is future work.
 */
export function useImageCleanup() {
  const sessionUploads = useRef(new Set<string>());

  const trackUpload = useCallback((publicId: string) => {
    sessionUploads.current.add(publicId);
  }, []);

  /** The editor removed `publicId` from the form (nothing was saved yet). `baseline` = last saved ids. */
  const imageRemoved = useCallback((publicId: string, baseline: readonly string[]) => {
    const { immediate } = plannedDeletes({
      baseline,
      saved: null,
      sessionUploads: [...sessionUploads.current],
      removedBeforeSave: [publicId],
    });
    immediate.forEach((id) => deleteAssetQuietly(id));
  }, []);

  /** A save succeeded: `baseline` is what was saved before it, `saved` what the product has now. */
  const saveSucceeded = useCallback((baseline: readonly string[], saved: readonly string[]) => {
    const { afterSave } = plannedDeletes({
      baseline,
      saved,
      sessionUploads: [...sessionUploads.current],
      removedBeforeSave: [],
    });
    afterSave.forEach((id) => deleteAssetQuietly(id));
  }, []);

  return { trackUpload, imageRemoved, saveSucceeded };
}
