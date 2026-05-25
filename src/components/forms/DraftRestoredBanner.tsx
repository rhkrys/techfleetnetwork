import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Icon } from "@/components/ui/icon";

/**
 * Shown above any create form when a server-side draft was restored on mount.
 * Always paired with `useServerDraft`. Lets a member discard the draft and
 * start fresh; otherwise typing simply continues from the restored state.
 */
interface DraftRestoredBannerProps {
  restoredAt: Date | null;
  onDiscard: () => void | Promise<void>;
  /** "draft" by default; override for clarity, e.g. "project draft". */
  noun?: string;
}

export function DraftRestoredBanner({
  restoredAt,
  onDiscard,
  noun = "draft",
}: DraftRestoredBannerProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const relative = restoredAt
    ? formatDistanceToNow(restoredAt, { addSuffix: true })
    : "just now";

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
        data-no-card
      >
        <div className="flex items-center gap-2 text-sm text-foreground">
          <Icon icon={FileText} size="ui" label="" />
          <span>
            Your {noun} from <span className="font-medium">{relative}</span> was restored.
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setConfirmOpen(true)}
          aria-label={`Discard ${noun} and start over`}
        >
          Discard {noun}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Discard ${noun}?`}
        consequence="Your saved progress will be cleared and you'll start with a blank form. This cannot be undone."
        actionLabel={`Discard ${noun}`}
        destructive
        loading={loading}
        onConfirm={async () => {
          setLoading(true);
          try {
            await onDiscard();
            setConfirmOpen(false);
          } finally {
            setLoading(false);
          }
        }}
      />
    </>
  );
}
