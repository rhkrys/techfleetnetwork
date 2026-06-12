import { useEffect, useRef } from "react";
import { useQueryClient } from "@/lib/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { createLogger } from "@/services/logger.service";

const log = createLogger("ProgressCacheIdentityGuard");

/**
 * Per the journey-display regression on 2026-06-12: if the in-memory React
 * Query cache contains journey/course-completion entries keyed to a *prior*
 * auth identity (sign-in refactor, OAuth bounce, account switch, or any
 * scenario where `user.id` changes without a full page reload), pages can
 * render "not completed" against zero rows even though the new identity has
 * full progress in the database.
 *
 * This guard watches `auth.user.id` and removes every progress-related cache
 * entry whenever the identity changes. Subsequent renders refetch under the
 * new identity, restoring the correct completion state without a hard refresh.
 *
 * No-ops on first mount; only fires on actual identity transitions.
 */
const PROGRESS_QUERY_KEYS = [
  "journey-progress",
  "journey-completed",
  "quest-all-journey-progress",
  "course_completions",
  "course-completions",
  "badges-awarded",
  "user-quest-selections",
  "quest-paths",
] as const;

export function ProgressCacheIdentityGuard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const lastIdRef = useRef<string | null>(null);

  useEffect(() => {
    const currentId = user?.id ?? null;
    const previousId = lastIdRef.current;

    if (previousId !== null && previousId !== currentId) {
      // Identity changed (sign-out, sign-in as different user, account switch).
      // Drop every cached progress row so the new identity sees its true state.
      for (const key of PROGRESS_QUERY_KEYS) {
        qc.removeQueries({ queryKey: [key] });
      }
      log.info(
        "identity-change",
        `auth identity changed (${previousId ?? "anon"} → ${currentId ?? "anon"}), cleared progress caches`,
        { previousId, currentId },
      );
    }

    lastIdRef.current = currentId;
  }, [user?.id, qc]);

  return null;
}
