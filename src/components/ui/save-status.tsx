// Universal save-status indicator.
// Wave 2 of the comprehensive refactor — see plan cross-cutting spine §1.
//
// One small primitive every form can drop in next to the Save button so
// members never wonder whether their changes persisted.
//
// States:
//   idle     — nothing to show
//   dirty    — "Unsaved changes"
//   saving   — "Saving…"
//   saved    — "Saved <relative time>"   (fades to idle after 5s)
//   error    — "Couldn't save. <Retry>"  (clickable verb CTA)

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface SaveStatusProps {
  state: SaveState;
  /** Timestamp of the last successful save, for relative time. */
  savedAt?: Date | null;
  /** Called when the user clicks Retry in the error state. */
  onRetry?: () => void;
  className?: string;
}

function relativeTime(d: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return d.toLocaleDateString();
}

export function SaveStatus({ state, savedAt, onRetry, className }: SaveStatusProps) {
  // Re-render every 15s so "Saved Xs ago" stays fresh without a parent timer.
  const [, setTick] = useState(0);
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (state !== "saved") return;
    const id = window.setInterval(() => setTick((t) => t + 1), 15_000);
    timerRef.current = id;
    return () => window.clearInterval(id);
  }, [state]);

  const base = "inline-flex items-center gap-2 text-sm";
  if (state === "idle") return null;

  if (state === "dirty") {
    return (
      <span className={cn(base, "text-muted-foreground", className)} aria-live="polite">
        <span className="size-2 rounded-full bg-amber-500" aria-hidden />
        Unsaved changes
      </span>
    );
  }
  if (state === "saving") {
    return (
      <span className={cn(base, "text-muted-foreground", className)} aria-live="polite">
        <span className="size-2 rounded-full bg-primary animate-pulse" aria-hidden />
        Saving…
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className={cn(base, "text-emerald-600 dark:text-emerald-400", className)} aria-live="polite">
        <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
        Saved{savedAt ? ` ${relativeTime(savedAt)}` : ""}
      </span>
    );
  }
  return (
    <span className={cn(base, "text-destructive", className)} aria-live="assertive" role="status">
      <span className="size-2 rounded-full bg-destructive" aria-hidden />
      Couldn't save.
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="underline underline-offset-2 font-medium hover:text-destructive/80"
        >
          Try again
        </button>
      ) : null}
    </span>
  );
}
