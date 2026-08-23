// Shared answer-feedback control for Fleety (👍/👎 + reason chips), used identically by all three
// chat surfaces. Self-contained: give it the assistant turn's id and it handles state + writes to
// fleety_message_feedback via the shared feedback client. Renders nothing without a turnId (e.g.
// the greeting message or a turn whose id never arrived).
import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/design-system";

import { useAuth } from "@/contexts/AuthContext";
import { FEEDBACK_REASONS, submitRating, submitReasons } from "@/lib/fleety/feedback";

export function FleetyMessageFeedback({ turnId }: { turnId?: string | null }) {
  const { user } = useAuth();
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [showReasons, setShowReasons] = useState(false);

  if (!turnId || !user) return null;

  const rate = async (value: 1 | -1) => {
    setRating(value);
    if (value === -1) setShowReasons(true);
    const { ok } = await submitRating(turnId, user.id, value);
    if (!ok) toast.error("Couldn't save your feedback.");
    else toast.success(value === 1 ? "Thanks — glad it helped!" : "Thanks — we'll improve it.");
  };

  const toggleReason = async (reason: string) => {
    const next = reasons.includes(reason)
      ? reasons.filter((r) => r !== reason)
      : [...reasons, reason];
    setReasons(next);
    const { ok } = await submitReasons(turnId, user.id, next);
    if (!ok) toast.error("Couldn't save the reason.");
  };

  return (
    <div className="mt-1">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => rate(1)}
          aria-label="Mark answer as helpful"
          aria-pressed={rating === 1}
          className={`h-6 px-1.5 text-xs gap-1 ${
            rating === 1 ? "text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ThumbsUp className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => rate(-1)}
          aria-label="Mark answer as not helpful"
          aria-pressed={rating === -1}
          className={`h-6 px-1.5 text-xs gap-1 ${
            rating === -1 ? "text-destructive" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ThumbsDown className="h-3 w-3" />
        </Button>
      </div>
      {showReasons && (
        <div
          className="mt-2 pt-2 border-t border-border/50 flex flex-wrap gap-1.5"
          role="group"
          aria-label="Why wasn't this helpful?"
        >
          <span className="text-[11px] text-muted-foreground self-center mr-1">What was off?</span>
          {FEEDBACK_REASONS.map((reason) => {
            const active = reasons.includes(reason);
            return (
              <Button
                key={reason}
                variant={active ? "secondary" : "outline"}
                size="sm"
                onClick={() => toggleReason(reason)}
                className="h-6 px-2 text-[11px]"
                aria-pressed={active}
              >
                {reason}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
