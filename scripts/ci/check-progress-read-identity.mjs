#!/usr/bin/env node
/**
 * JOURNEY-IDENTITY-003 guard: every client read against
 * journey_progress / course_completions / badges_awarded must filter by
 * the session user id (`user.id` from useAuth/session), NEVER by
 * `profile.id`. profile.id is the profile-table PK and does NOT equal
 * `auth.uid()`, so filtering by it returns zero rows under RLS and
 * silently regresses completion state.
 *
 * Forbidden .eq("user_id", …) args: profile.id, profile?.id,
 * currentProfile.id, p.id.  (profile.user_id / profile?.user_id are OK.)
 *
 * Scan/fail-closed/zero-scan/evidence owned by the shared harness (_guard.mjs).
 */
import { runScanGuard, lineOf } from "./_guard.mjs";

const TABLES = [
  "journey_progress",
  "course_completions",
  "badges_awarded",
  "journey_phase_definitions",
];
const FORBIDDEN_USER_ID_ARG = /\.eq\(\s*["']user_id["']\s*,\s*([^)]+?)\s*\)/g;
const FROM_TABLE = (t) => new RegExp(`from\\(\\s*["']${t}["']\\s*\\)`);

runScanGuard({
  name: "check-progress-read-identity",
  roots: ["src"],
  include: /\.(ts|tsx)$/,
  exclude: /\.test\.(ts|tsx)$/,
  rule(src) {
    const touchesTable = TABLES.some((t) => FROM_TABLE(t).test(src));
    if (!touchesTable) return [];

    const out = [];
    let m;
    FORBIDDEN_USER_ID_ARG.lastIndex = 0;
    while ((m = FORBIDDEN_USER_ID_ARG.exec(src)) !== null) {
      const arg = m[1].trim();
      // Bare `profile.id` / `profile?.id` / `currentProfile.id` / `p.id` are forbidden.
      // `profile.user_id` and `profile?.user_id` are OK (FK column).
      const isForbidden =
        /^(currentProfile|profile|p)\??\.id$/.test(arg) ||
        (/\b(currentProfile|profile)\??\.id\b/.test(arg) && !/user_id/.test(arg));
      if (isForbidden) {
        out.push({ line: lineOf(src, m.index), text: `.eq("user_id", ${arg})` });
      }
    }
    return out;
  },
});
