/**
 * AutosaveStatus — inline pill placed left of the Save draft button.
 *
 * Renders semantic states from `useAutosave`. Uses `aria-live="polite"` so
 * screen readers announce save outcomes without interrupting.
 */
import { Check, CircleAlert, Loader2, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AutosaveStatus as Status } from "@/hooks/use-autosave";

interface Props {
  status: Status;
  lastSavedAt: Date | null;
  onRetry?: () => void;
  className?: string;
}

function relativeLabel(d: Date | null): string {
  if (!d) return "";
  const diff = Math.max(0, Date.now() - d.getTime());
  if (diff < 5_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function AutosaveStatus({ status, lastSavedAt, onRetry, className }: Props) {
  if (status === "idle") return null;

  const base = "inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border";

  if (status === "saving") {
    return (
      <span
        className={cn(base, "bg-muted/50 border-border text-muted-foreground", className)}
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        Saving…
      </span>
    );
  }

  if (status === "dirty") {
    return (
      <span
        className={cn(base, "bg-muted/50 border-border text-muted-foreground", className)}
        role="status"
        aria-live="polite"
      >
        Unsaved changes
      </span>
    );
  }

  if (status === "saved") {
    return (
      <span
        className={cn(base, "bg-success/10 border-success/30 text-success", className)}
        role="status"
        aria-live="polite"
      >
        <Check className="h-3 w-3" aria-hidden="true" />
        Saved · {relativeLabel(lastSavedAt)}
      </span>
    );
  }

  // error
  return (
    <span
      className={cn(base, "bg-destructive/10 border-destructive/30 text-destructive", className)}
      role="status"
      aria-live="polite"
    >
      <CircleAlert className="h-3 w-3" aria-hidden="true" />
      Save failed
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="ml-1 inline-flex items-center gap-1 underline underline-offset-2 hover:opacity-80"
        >
          <RotateCw className="h-3 w-3" aria-hidden="true" />
          Retry
        </button>
      )}
    </span>
  );
}
