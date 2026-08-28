#!/usr/bin/env node
/**
 * SUPPORT-IDENTITY-001 guard (audit T-A): the support/Freescout subsystem must
 * key on the AUTH uid (profiles.user_id = auth.uid()), NEVER the random
 * profiles.id PK. Two forbidden shapes:
 *   (a) .from("profiles") … .eq("id", <auth-uid-like>)  (`.eq("id", prof.id)` is fine)
 *   (b) writing a profiles PK into a *_user_id identity column of a support table.
 * Both silently break (profiles.id never equals auth.uid()). Mirrors
 * scripts/ci/check-progress-read-identity.mjs.
 *
 * Scan/fail-closed/zero-scan/evidence owned by the shared harness (_guard.mjs).
 */
import { runScanGuard, lineOf } from "./_guard.mjs";

const SUPPORT_TABLES = [
  "support_provisioning_log",
  "support_ticket_pointers",
  "support_ticket_events",
];
// An argument that clearly holds an auth uid (so filtering profiles.id by it is a bug).
const AUTH_UID_LIKE = /(user_?id|\buid\b|auth\.uid)/i;
// A profiles-PK self-reference, which is the legitimate arg for `.eq("id", …)`.
const IS_PK_REF = /^(prof|profile|p|row)\??\.id$/;

runScanGuard({
  name: "check-support-identity",
  roots: ["supabase/functions", "src"],
  include: /\.(ts|tsx)$/,
  exclude: /\.test\.(ts|tsx)$/,
  rule(src, rel) {
    if (rel.includes("/test/")) return [];
    const out = [];

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
          out.push({
            line: lineOf(src, fm.index + em.index),
            text: `.from("profiles")…\.eq("id", ${arg}) — use .eq("user_id", …)`,
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
          out.push({
            line: lineOf(src, tm.index + pm.index),
            text: `${t}: { ${pm[1]}: ${pm[2]}.id } — write the auth uid (…​.user_id), not the profiles PK`,
          });
        }
      }
    }

    return out;
  },
});
