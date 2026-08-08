/**
 * Pure, client-side MIRROR of the server release engine
 * (public.class_item_release). This is used ONLY to render display state such
 * as "Available on …" and to keep the UI honest; it is NEVER a security
 * boundary. The server RPC get_class_curriculum_for_learner is authoritative
 * and already omits the body of locked items, so a tampered client can render
 * a lock incorrectly but can never reveal content it wasn't given.
 *
 * Kept logic-only (no React, no Supabase) so it is exhaustively unit-testable —
 * see release.test.ts. Semantics must stay in lockstep with the SQL in
 * supabase/migrations/20260808160200_class_curriculum_v2_release_engine.sql.
 */
import type { ClassReleasePolicy } from "../types";

export interface ReleaseInput {
  policy: ClassReleasePolicy;
  /** ISO timestamp; required when policy === 'by_date'. */
  releaseAt?: string | null;
  /** required when policy === 'relative_to_cohort_start'. */
  offsetDays?: number | null;
  /** the learner's OWN cohort start (ISO date) — F10. */
  cohortStart?: string | null;
  /** for 'after_previous_completion': is the previous required item complete? */
  previousCompleted?: boolean;
  /** true when this is the first required item (no predecessor). */
  isFirst?: boolean;
  /** evaluation clock; injectable for deterministic tests. */
  now?: Date;
}

export interface ReleaseResult {
  released: boolean;
  /** when it becomes available, if computable; null when it depends on completion. */
  availableAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeRelease(input: ReleaseInput): ReleaseResult {
  const now = input.now ?? new Date();

  switch (input.policy) {
    case "all_at_once":
      return { released: true, availableAt: now };

    case "by_date": {
      if (!input.releaseAt) return { released: false, availableAt: null };
      const at = new Date(input.releaseAt);
      return { released: now.getTime() >= at.getTime(), availableAt: at };
    }

    case "relative_to_cohort_start": {
      if (!input.cohortStart || input.offsetDays == null) {
        return { released: false, availableAt: null };
      }
      const start = new Date(input.cohortStart);
      const at = new Date(start.getTime() + input.offsetDays * DAY_MS);
      return { released: now.getTime() >= at.getTime(), availableAt: at };
    }

    case "after_previous_completion": {
      if (input.isFirst) return { released: true, availableAt: now };
      return { released: !!input.previousCompleted, availableAt: null };
    }

    default:
      return { released: false, availableAt: null };
  }
}

/** Human-readable label for a locked (or released) item's availability. */
export function availabilityLabel(
  result: ReleaseResult,
  policy: ClassReleasePolicy,
  tzLabel?: string
): string {
  if (result.released) return "Available";
  if (policy === "after_previous_completion") {
    return "Complete the previous lesson to unlock";
  }
  if (result.availableAt) {
    const d = result.availableAt.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return `Available on ${d}${tzLabel ? ` (${tzLabel})` : ""}`;
  }
  return "Not yet available";
}
