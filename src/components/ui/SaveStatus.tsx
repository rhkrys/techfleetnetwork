// Universal SaveStatus indicator — Cross-cutting Spine §1 of the refactor.
//
// Surfaces explicit save state next to every save button: "Saved 2s ago",
// "Saving…", "Unsaved changes", or "Save failed". Replaces the silent
// per-field auto-save pattern that drove p95 = 27 profile edits/user.
//
// Brand voice (memory):
//   - Sentence case, plain English, ≥1rem text.
//   - Status text reads at 7th-grade level.
//   - No icons in card body (icons here are micro UI-status indicators only,
//     allowed via the <Icon size="micro"/> primitive).
//
// Usage:
//   <SaveStatus state="saving" />
//   <SaveStatus state="saved" savedAt={savedAt} />
//   <SaveStatus state="dirty" />
//   <SaveStatus state="error" message="Network hiccup — try again." />

import { useEffect, useState } from "react";
import { Check, CircleAlert, Loader2, PencilLine } from "lucide-react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

export type SaveStatusState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface SaveStatusProps {
  state: SaveStatusState;
  /** Required when state === 'saved' — the timestamp the save completed. */
  savedAt?: Date | string | number | null;
  /** Optional error message shown when state === 'error'. */
  message?: string;
  className?: string;
  /** Polite live-region announcement for screen readers. Default true. */
  announce?: boolean;
}

function toDate(value: SaveStatusProps["savedAt"]): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatRelative(date: Date, now: Date): string {
  const secs = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function SaveStatus({
  state,
  savedAt,
  message,
  className,
  announce = true,
}: SaveStatusProps) {
  // Re-render every 15s so the "Saved Ns ago" label stays fresh.
  const [, force] = useState(0);
  useEffect(() => {
    if (state !== "saved") return;
    const id = window.setInterval(() => force((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, [state]);

  if (state === "idle") return null;

  let label = "";
  let tone = "text-muted-foreground";
  let icon: React.ReactNode = null;

  if (state === "dirty") {
    label = "Unsaved changes";
    tone = "text-[hsl(var(--alert-orange))]";
    icon = <Icon icon={PencilLine} size="micro" label="" />;
  } else if (state === "saving") {
    label = "Saving…";
    tone = "text-muted-foreground";
    icon = <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />;
  } else if (state === "saved") {
    const d = toDate(savedAt);
    label = d ? `Saved ${formatRelative(d, new Date())}` : "Saved";
    tone = "text-[hsl(var(--growth-green))]";
    icon = <Icon icon={Check} size="micro" label="" />;
  } else if (state === "error") {
    label = message ?? "Save failed. Try again.";
    tone = "text-[hsl(var(--destructive))]";
    icon = <Icon icon={CircleAlert} size="micro" label="" />;
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 text-sm font-medium",
        tone,
        className,
      )}
      role={announce ? "status" : undefined}
      aria-live={announce ? "polite" : undefined}
      aria-atomic="true"
      data-save-status={state}
    >
      {icon}
      <span>{label}</span>
    </div>
  );
}

export default SaveStatus;
