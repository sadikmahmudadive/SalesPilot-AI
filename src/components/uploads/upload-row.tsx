import { CircleAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { UploadStatus } from "@/hooks/use-upload";

export interface UploadItem {
  id: string;
  name: string;
  /** `queued` waits for the one running upload; `error` stays until dismissed. */
  phase: "queued" | "active" | "error";
  message?: string;
}

const STATUS_TEXT: Partial<Record<UploadStatus, string>> = {
  signing: "Preparing",
  confirming: "Finishing",
};

interface UploadRowProps {
  item: UploadItem;
  /** State of the running upload; only read for the `active` row. */
  status: UploadStatus;
  progress: number;
  onCancel: (id: string) => void;
}

/** One file in the upload list: progress while it runs, its error afterwards. */
export function UploadRow({ item, status, progress, onCancel }: UploadRowProps) {
  const failed = item.phase === "error";
  const active = item.phase === "active";
  const percent = active ? (status === "uploading" ? progress : status === "confirming" ? 100 : 0) : 0;
  const text = active ? (STATUS_TEXT[status] ?? `Uploading ${percent}%`) : "Waiting";

  return (
    <li className="flex items-center gap-3 rounded-lg border px-3 py-2">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 truncate font-medium">{item.name}</span>
          {failed ? null : <span className="shrink-0 text-xs text-muted-foreground">{text}</span>}
        </div>
        {failed ? (
          <p className="flex items-start gap-1.5 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {item.message}
          </p>
        ) : (
          <div
            role="progressbar"
            aria-label={`Upload progress for ${item.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => onCancel(item.id)}
        aria-label={failed ? `Dismiss error for ${item.name}` : `Cancel upload of ${item.name}`}
      >
        <X aria-hidden="true" />
      </Button>
    </li>
  );
}
