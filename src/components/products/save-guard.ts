/**
 * What the product editor allows while images are uploading. Pure.
 *
 * An upload that finishes during a save would be added to the form and then wiped by the reset that
 * follows the save, leaving an orphaned file; leaving the page cancels the upload. So Save waits for
 * uploads, and a running upload counts as unsaved work (Cancel / Back ask first, the browser warns).
 */
export interface SaveGuardInput {
  dirty: boolean;
  canWrite: boolean;
  /** The uploader has something queued, uploading or confirming. */
  uploading: boolean;
}

export interface SaveGuard {
  canSave: boolean;
  hasUnsavedWork: boolean;
  hint: string | null;
}

export function saveGuard({ dirty, canWrite, uploading }: SaveGuardInput): SaveGuard {
  return {
    canSave: canWrite && !uploading,
    hasUnsavedWork: canWrite && (dirty || uploading),
    hint: canWrite && uploading ? "Wait for uploads to finish" : null,
  };
}
