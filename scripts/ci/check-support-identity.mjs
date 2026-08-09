#!/usr/bin/env node
/**
 * SUPPORT-IDENTITY-001 guard (audit T-A): the support/Freescout subsystem must
 * key on the AUTH uid (`profiles.user_id` = auth.uid()), NEVER the random
 * `profiles.id` PK. Two forbidden shapes:
 *
 *   (a) reading `profiles` by the PK with an auth-uid argument:
 *         .from("profiles") … .eq("id", <userId|user_id|uid|auth.uid()|…>)
 *       (`.eq("id", prof.id)` / `p.id` PK-updates are fine.)
 *
 *   (b) writing a profiles PK into a *_user_id identity column of a support table:
 *         .from("support_provisioning_log"|"support_ticket_pointers"|
 *               "support_ticket_events") … { user_id | customer_user_id: prof.id }
 *
 * Both silently break (profiles.id never equals auth.uid()): reads return no row,
 * writes poison the column so downstream lookups miss. Scans edge functions +
 * frontend. Mirrors scripts/ci/check-progress-read-identity.mjs.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOTS = ["supabase/functions", "src"];
const EXTS = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", "coverage"]);
const SUPPORT_TABLES = [
  "support_provisioning_log",
  "support_ticket_pointers",
  "support_ticket_events",
];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (EXTS.has(extname(name))) yield full;
  }
}

// An argument that clearly holds an auth uid (so filtering profiles.id by it is a bug).
const AUTH_UID_LIKE = /(user_?id|\buid\b|auth\.uid)/i;
// A profiles-PK self-reference, which is the legitimate arg for `.eq("id", …)`.
const IS_PK_REF = /^(prof|profile|p|row)\??\.id$/;

const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;
const violations = [];

for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx") || file.includes("/test/"))
      continue;
    if (file.replace(/\\/g, "/").endsWith("scripts/ci/check-support-identity.mjs")) continue;
    const src = readFileSync(file, "utf8");

    // (a) .from("profiles") … .eq("id", <auth-uid-like>)  — window after each match.
    const fromRe = /\.from\(\s*["']profiles["']\s*\)/g;
    let fm;
    while ((fm = fromRe.exec(src)) !== null) {
      const window = src.slice(fm.index, fm.index + 400);
      const eqRe = /\.eq\(\s*["']id["']\s*,\s*([^)]+?)\s*\)/g;
      let em;
      while ((em = eqRe.exec(window)) !== null) {
        const arg = em[1].trim();
        if (IS_PK_REF.test(arg)) continue; // legit PK update/read
        if (AUTH_UID_LIKE.test(arg)) {
          violations.push({
            file,
            line: lineOf(src, fm.index + em.index),
            msg: `.from("profiles")…\.eq("id", ${arg}) — use .eq("user_id", …)`,
          });
        }
      }
    }

    // (b) writing a profiles PK into a support table's identity column.
    for (const t of SUPPORT_TABLES) {
      const tRe = new RegExp(`\\.from\\(\\s*["']${t}["']\\s*\\)`, "g");
      let tm;
      while ((tm = tRe.exec(src)) !== null) {
        const window = src.slice(tm.index, tm.index + 400);
        const pkWrite = /(user_id|customer_user_id)\s*:\s*(prof|profile|p)\??\.id\b/g;
        let pm;
        while ((pm = pkWrite.exec(window)) !== null) {
          violations.push({
            file,
            line: lineOf(src, tm.index + pm.index),
            msg: `${t}: { ${pm[1]}: ${pm[2]}.id } — write the auth uid (…​.user_id), not the profiles PK`,
          });
        }
      }
    }
  }
}

if (violations.length) {
  console.error(
    "❌ SUPPORT-IDENTITY-001 violations: the support subsystem must key on the auth uid (profiles.user_id), not profiles.id:"
  );
  for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.msg}`);
  console.error(
    '\nFix: look up profiles by .eq("user_id", <authUid>) and store <authUid> in *_user_id columns.'
  );
  process.exit(1);
}

console.log("✓ SUPPORT-IDENTITY-001: support subsystem keys on the auth uid, not profiles.id");
