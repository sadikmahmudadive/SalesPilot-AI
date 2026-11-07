"use client";

import { useCallback, useState } from "react";

import { apiFetch } from "@/lib/api/client";
import type { UploadKind } from "@/lib/cloudinary/folders";
import {
  MESSAGES,
  runUpload,
  UploadFlowError,
  type UploadDeps,
  type UploadOutcome,
} from "@/lib/uploads/upload-flow";
import { xhrUpload } from "@/lib/uploads/xhr-upload";
import type { ConfirmedUpload } from "@/schemas/upload";

export type UploadStatus = "idle" | "signing" | "uploading" | "confirming" | "done" | "error";

export interface UploadState {
  status: UploadStatus;
  /** Upload progress, 0-100. */
  progress: number;
  /** Why the last upload failed; `null` otherwise (a cancelled upload is not an error). */
  error: UploadOutcome | null;
}

const IDLE: UploadState = { status: "idle", progress: 0, error: null };

const deps: UploadDeps = {
  post: (path, body, signal) => apiFetch(path, { method: "POST", body, signal }),
  xhrUpload,
  createFormData: () => new FormData(),
};

/**
 * Uploads one file at a time through the sign -> Cloudinary -> confirm sequence. `state` follows the
 * most recent `upload` call. `upload` rejects with an `UploadFlowError` (its `outcome` says why;
 * `aborted` means the caller's signal fired and nothing should be shown).
 */
export function useUpload(kind: UploadKind) {
  const [state, setState] = useState<UploadState>(IDLE);

  const upload = useCallback(
    async (file: File, { signal }: { signal?: AbortSignal } = {}): Promise<ConfirmedUpload> => {
      setState({ status: "signing", progress: 0, error: null });
      try {
        const image = await runUpload(deps, kind, file, {
          signal,
          onStage: (stage) =>
            setState((s) => ({
              ...s,
              status: stage,
              progress: stage === "confirming" ? 100 : s.progress,
            })),
          onProgress: (progress) => setState((s) => ({ ...s, progress })),
        });
        setState({ status: "done", progress: 100, error: null });
        return image;
      } catch (error) {
        const outcome: UploadOutcome =
          error instanceof UploadFlowError
            ? error.outcome
            : { kind: "error", message: MESSAGES.generic };
        setState(
          outcome.kind === "aborted" ? IDLE : { status: "error", progress: 0, error: outcome },
        );
        throw error instanceof UploadFlowError ? error : new UploadFlowError(outcome);
      }
    },
    [kind],
  );

  const reset = useCallback(() => setState(IDLE), []);

  return { ...state, upload, reset };
}
