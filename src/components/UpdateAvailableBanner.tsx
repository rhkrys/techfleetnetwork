import { useEffect, useState } from "react";
import { onDeployStale, reloadIfStale } from "@/lib/deploy-watcher";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { X } from "lucide-react";

/**
 * Non-blocking, dismissible banner shown when a new build is available.
 * Never auto-reloads — the member chooses when to refresh so unsaved
 * drafts, scroll position, and modal state survive.
 */
export function UpdateAvailableBanner() {
  const [stale, setStale] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => onDeployStale(setStale), []);

  if (!stale || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-[60] w-[min(92vw,32rem)] -translate-x-1/2 rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80"
      data-testid="update-available-banner"
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 text-[0.95rem] text-foreground">
          A new version is ready. Refresh when you're done to load the latest updates.
        </div>
        <Button
          size="sm"
          onClick={() => reloadIfStale()}
          className="shrink-0"
        >
          Refresh now
        </Button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Dismiss update notice"
        >
          <Icon icon={X} size="ui" label="Dismiss" />
        </button>
      </div>
    </div>
  );
}
