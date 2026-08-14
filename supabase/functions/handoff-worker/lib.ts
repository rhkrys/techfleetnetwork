// Pure, testable helpers for the handoff-worker (extracted so the serve() handler stays thin and this
// logic is unit-tested without standing up a server). See supabase/functions/handoff-worker/index.ts.
import type { Cursor } from "../handoff-produce/pipeline-steps.ts";

/** Map the resumable step-machine cursor to the run's coarse status (observability while it advances).
 *  extract -> extracting, write -> writing, everything else (finalize/done) -> rendering. */
export function statusForCursor(c: Cursor): string {
  switch (c.stage) {
    case "ingest":
      return "parsing";
    case "extract":
      return "extracting";
    case "write":
      return "writing";
    default:
      return "rendering";
  }
}

/** Constant-time-ish bearer comparison for the service-role-only worker. Fails closed: an empty
 *  expected key (unset SUPABASE_SERVICE_ROLE_KEY) or any length mismatch denies without a byte compare. */
export function bearerMatches(got: string, expected: string): boolean {
  if (!expected || got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
