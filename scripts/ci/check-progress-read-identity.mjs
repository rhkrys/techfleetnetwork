#!/usr/bin/env node
/**
 * JOURNEY-IDENTITY-003 guard: every client read against
 * journey_progress / course_completions / badges_awarded must filter by
 * the session user id (`user.id` from useAuth/session), NEVER by
 * `profile.id`. profile.id is the profile-table PK and does NOT equal
 * `auth.uid()`, so filtering by it returns zero rows under RLS and
 * silently regresses completion state.
 *
 * Allowed identifier shapes for the .eq("user_id", ...) argument:
 *   user.id, user?.id, session.user.id, session?.user?.id,
 *   userId, p_user_id, currentUser.id, currentUser?.id,
 *   data.user.id, auth.user.id, authUser.id,
 *   profile.user_id, profile?.user_id   <-- the FK column, not the PK
 *
 * Forbidden: profile.id, profile?.id, currentProfile.id, p.id
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const TABLES = ["journey_progress", "course_completions", "badges_awarded", "journey_phase_definitions"];
const ROOTS = ["src"];
const EXTS = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", "coverage"]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (EXTS.has(extname(name))) yield full;
  }
}

const FORBIDDEN_USER_ID_ARG = /\.eq\(\s*["']user_id["']\s*,\s*([^)]+?)\s*\)/g;
const FROM_TABLE = (t) => new RegExp(`from\\(\\s*["']${t}["']\\s*\\)`);

const violations = [];

for (const root of ROOTS) {
  for (const file of walk(root)) {
    // skip tests + the guard itself
    if (file.includes("__tests__") || file.endsWith(".test.ts") || file.endsWith(".test.tsx") || file.includes("/test/")) continue;
    const src = readFileSync(file, "utf8");
    const touchesTable = TABLES.some((t) => FROM_TABLE(t).test(src));
    if (!touchesTable) continue;

    // Look for `.eq("user_id", <arg>)` and flag forbidden args
    let m;
    while ((m = FORBIDDEN_USER_ID_ARG.exec(src)) !== null) {
      const arg = m[1].trim();
      // Bare `profile.id` / `profile?.id` / `currentProfile.id` / `p.id` are forbidden.
      // `profile.user_id` and `profile?.user_id` are OK (FK column).
      const isForbidden =
        /^(currentProfile|profile|p)\??\.id$/.test(arg) ||
        /\b(currentProfile|profile)\??\.id\b/.test(arg) && !/user_id/.test(arg);
      if (isForbidden) {
        const before = src.slice(0, m.index).split("\n");
        violations.push({ file, line: before.length, arg });
      }
    }
  }
}

if (violations.length) {
  console.error("❌ JOURNEY-IDENTITY-003 violations: client reads against journey/course tables MUST filter by session user.id, not profile.id");
  for (const v of violations) console.error(`  ${v.file}:${v.line}  .eq("user_id", ${v.arg})`);
  console.error("\nFix: replace `profile.id` with `user.id` (from useAuth) or `session.user.id`.");
  process.exit(1);
}

console.log("✓ JOURNEY-IDENTITY-003: all journey/course reads filter by session user.id");
