"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ImageOff, Upload } from "lucide-react";

import { LiveStatus, useAnnouncer } from "@/components/shared/live-status";
import { UploadRow, type UploadItem } from "@/components/uploads/upload-row";
import { Button } from "@/components/ui/button";
import { useUpload } from "@/hooks/use-upload";
import { kindPermission, type UploadKind } from "@/lib/cloudinary/folders";
import { can, type Role } from "@/lib/security/permissions";
import { cn } from "@/lib/utils";
import { MESSAGES, policyFor, precheckFile, UploadFlowError } from "@/lib/uploads/upload-flow";
import type { ConfirmedUpload } from "@/schemas/upload";

export const SETUP_GUIDE_PATH = "docs/setup/cloudinary.md";

interface MediaUploaderProps {
  kind: UploadKind;
  /** Hides the uploader for roles without the kind's upload permission (the server still enforces it). */
  role: Role;
  maxFiles: number;
  /** How many files already exist; only `maxFiles - currentCount` more are accepted. */
  currentCount: number;
  onUploaded: (image: ConfirmedUpload) => void;
  disabled?: boolean;
  /** Called with `true` while anything is queued, uploading or confirming, and `false` otherwise. */
  onBusyChange?: (busy: boolean) => void;
  /** The file input, so a parent can move focus to the uploader. */
  ref?: React.Ref<HTMLInputElement>;
}

let nextItemId = 0;

function NotConfigured({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center"
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <ImageOff className="size-5" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium">Media storage not configured</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Image uploads need media storage. An owner or admin can set it up by following{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{SETUP_GUIDE_PATH}</code>
          . Existing images stay as they are.
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Check again
      </Button>
    </div>
  );
}

/**
 * File picker + drop zone that uploads images one at a time (kinder to rate limits) and reports
 * each finished image through `onUploaded`. Files that fail the client pre-check are reported at
 * once without any network call. Progress, cancellation and errors are per file; completion and
 * failure are announced through a polite live region.
 */
export function MediaUploader({
  kind,
  role,
  maxFiles,
  currentCount,
  onUploaded,
  disabled = false,
  onBusyChange,
  ref,
}: MediaUploaderProps) {
  const inputId = useId();
  const hintId = useId();
  const policy = policyFor(kind);
  const { upload, status, progress } = useUpload(kind);

  const [items, setItems] = useState<UploadItem[]>([]);
  const [notice, setNotice] = useState("");
  const { message: announcement, announce } = useAnnouncer();
  const [notConfigured, setNotConfigured] = useState(false);
  const [dragging, setDragging] = useState(false);

  const files = useRef(new Map<string, File>());
  const queue = useRef<string[]>([]);
  const running = useRef(false);
  const activeId = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const latestOnUploaded = useRef(onUploaded);
  useEffect(() => {
    latestOnUploaded.current = onUploaded;
  }, [onUploaded]);

  const busy = items.some((item) => item.phase !== "error");
  const latestOnBusyChange = useRef(onBusyChange);
  useEffect(() => {
    latestOnBusyChange.current = onBusyChange;
  }, [onBusyChange]);
  useEffect(() => {
    latestOnBusyChange.current?.(busy);
  }, [busy]);
  useEffect(() => () => latestOnBusyChange.current?.(false), []);

  // Leaving the page cancels the running upload and drops the waiting ones.
  useEffect(
    () => () => {
      queue.current = [];
      controller.current?.abort();
    },
    [],
  );

  const patch = useCallback((id: string, change: Partial<UploadItem>) => {
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...change } : item)));
  }, []);
  const drop = useCallback((id: string) => {
    files.current.delete(id);
    setItems((list) => list.filter((item) => item.id !== id));
  }, []);

  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (let id = queue.current.shift(); id !== undefined; id = queue.current.shift()) {
        const file = files.current.get(id);
        if (!file) continue;
        activeId.current = id;
        const ctl = new AbortController();
        controller.current = ctl;
        patch(id, { phase: "active" });
        try {
          const image = await upload(file, { signal: ctl.signal });
          latestOnUploaded.current(image);
          drop(id);
          announce(`${file.name} uploaded`);
        } catch (error) {
          const outcome =
            error instanceof UploadFlowError
              ? error.outcome
              : { kind: "error" as const, message: MESSAGES.generic };
          if (outcome.kind === "aborted") {
            drop(id);
          } else if (outcome.kind === "not-configured") {
            queue.current = [];
            files.current.clear();
            setItems([]);
            setNotConfigured(true);
          } else {
            patch(id, { phase: "error", message: outcome.message });
            announce(`${file.name} failed. ${outcome.message}`);
          }
        } finally {
          activeId.current = null;
          controller.current = null;
        }
      }
    } finally {
      running.current = false;
    }
  }, [upload, patch, drop, announce]);

  function addFiles(list: File[]) {
    if (disabled || notConfigured || list.length === 0) return;
    setNotice("");
    const valid: File[] = [];
    const rejected: UploadItem[] = [];
    for (const file of list) {
      const problem = precheckFile(kind, file);
      if (problem)
        rejected.push({
          id: `upload-${nextItemId++}`,
          name: file.name,
          phase: "error",
          message: problem,
        });
      else valid.push(file);
    }

    const waiting = items.filter((item) => item.phase !== "error").length;
    const room = Math.max(0, maxFiles - currentCount - waiting);
    const accepted = valid.slice(0, room);
    if (valid.length > accepted.length) {
      setNotice(
        room === 0
          ? `You have reached the maximum of ${maxFiles} images.`
          : `Only ${room} more ${room === 1 ? "image" : "images"} can be added (maximum ${maxFiles}). The rest were skipped.`,
      );
    }

    const added: UploadItem[] = accepted.map((file) => {
      const id = `upload-${nextItemId++}`;
      files.current.set(id, file);
      queue.current.push(id);
      return { id, name: file.name, phase: "queued" };
    });
    setItems((current) => [...current, ...rejected, ...added]);
    if (added.length > 0) void drain();
  }

  function cancel(id: string) {
    if (id === activeId.current) {
      if (status === "confirming") return; // the server is already recording the file: aborting cannot undo it
      controller.current?.abort();
      return;
    }
    queue.current = queue.current.filter((queued) => queued !== id);
    drop(id);
  }

  if (!can(role, kindPermission(kind))) return null;
  if (!policy) return null;
  if (notConfigured) return <NotConfigured onRetry={() => setNotConfigured(false)} />;

  const remaining = Math.max(0, maxFiles - currentCount);
  const blocked = disabled || remaining === 0;
  const mb = Math.floor(policy.maxBytes / (1024 * 1024));

  return (
    <div className="space-y-3">
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault(); // always: otherwise the browser would open the dropped image in this tab
          if (!blocked) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (blocked) return;
          addFiles(Array.from(event.dataTransfer.files));
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
          "hover:bg-muted/50 has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
          dragging && "border-ring bg-muted/50",
          blocked && "cursor-not-allowed opacity-50 hover:bg-transparent",
        )}
      >
        <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Upload className="size-5" aria-hidden="true" />
        </span>
        <span className="text-sm font-medium">
          {dragging ? "Drop images to upload" : "Choose images or drop them here"}
        </span>
        <span id={hintId} className="text-xs text-muted-foreground">
          {remaining === 0
            ? `You have reached the maximum of ${maxFiles} images.`
            : `JPEG, PNG, WebP or AVIF, up to ${mb} MB each. ${remaining} more can be added.`}
        </span>
        <input
          id={inputId}
          ref={ref}
          type="file"
          multiple
          accept={policy.contentTypes.join(",")}
          disabled={blocked}
          aria-describedby={hintId}
          className="sr-only"
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            event.target.value = ""; // picking the same file again must still fire a change
          }}
        />
      </label>

      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}

      {items.length > 0 ? (
        <ul className="space-y-2" aria-label="Uploads">
          {items.map((item) => (
            <UploadRow
              key={item.id}
              item={item}
              status={status}
              progress={progress}
              onCancel={cancel}
            />
          ))}
        </ul>
      ) : null}

      <LiveStatus message={announcement} />
    </div>
  );
}
