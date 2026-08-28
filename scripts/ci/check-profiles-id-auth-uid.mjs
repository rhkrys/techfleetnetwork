#!/usr/bin/env node
// Audit T-A guard: `profiles.id` is a random PK; the auth identity column is
// `user_id` (== auth.uid()). Confusing them silently no-ops identity
// lookups/updates. Flags the two recurring shapes:
//   1. Edge fns:  `.from("profiles") … .eq("id", <authUid>)`  → use .eq("user_id", …)
//   2. Post-cutoff migrations: a `public.profiles` statement with `id = auth.uid()`.
// The edge check IGNORES `.eq("id", <expr>.id)` (a resolved-row PK ref) EXCEPT the
// `user.id` form (that IS the auth uid). Escape hatch: `@profiles-id-ok` on the
// flagged line / line above (migrations: anywhere in the file).
//
// Scan/fail-closed/zero-scan/evidence owned by the shared harness (_guard.mjs).
import { runScanGuard } from "./_guard.mjs";

const HATCH = /@profiles-id-ok/;
// Migrations on/before this stamp are immutable, already-applied history; only
// new/edited migrations are enforced.
const BASELINE_CUTOFF = "20260809182000";
const EQ_ID_RE = /\.eq\(\s*["']id["']\s*,\s*([^,)]+?)\s*\)/;
const PK_PROP_RE = /\.id$/;
const USER_ID_PROP_RE = /^(user|data\.user|\{?\s*user)\b.*\.id$/;

function edgeRule(src) {
  const out = [];
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/\.from\(\s*["']profiles["']\s*\)/.test(lines[i])) continue;
    for (let j = i; j <= Math.min(i + 8, lines.length - 1); j++) {
      const l = lines[j];
      const m = l.match(EQ_ID_RE);
      if (m && !HATCH.test(l) && !HATCH.test(lines[j - 1] ?? "")) {
        const arg = m[1].trim();
        const isPkProp = PK_PROP_RE.test(arg) && !USER_ID_PROP_RE.test(arg);
        if (!isPkProp) {
          out.push({
            line: j + 1,
            text: `.from("profiles") … .eq("id", ${arg}) — profiles.id is the PK; use .eq("user_id", …) (or // @profiles-id-ok)`,
          });
        }
      }
      if (/\.(maybeSingle|single|then)\(/.test(l) || /;\s*$/.test(l)) break;
    }
  }
  return out;
}

function migrationRule(src, fileName) {
  if (fileName.slice(0, 14) <= BASELINE_CUTOFF) return [];
  if (HATCH.test(src)) return [];
  if (
    /(update|from|join)\s+(public\.)?profiles\b[\s\S]{0,240}?\bid\s*=\s*auth\.uid\(\)/i.test(src)
  ) {
    return [
      {
        text: "a public.profiles statement uses `id = auth.uid()` — use `user_id = auth.uid()` (or -- @profiles-id-ok)",
      },
    ];
  }
  return [];
}

runScanGuard({
  name: "check-profiles-id-auth-uid",
  roots: ["supabase/functions", "supabase/migrations"],
  include: /\.(ts|sql)$/,
  exclude: /\.test\.ts$/,
  rule(src, rel) {
    if (rel.startsWith("supabase/functions/") && rel.endsWith(".ts")) return edgeRule(src);
    if (rel.startsWith("supabase/migrations/") && rel.endsWith(".sql")) {
      return migrationRule(src, rel.split("/").pop());
    }
    return [];
  },
  summary: (_n, files) => {
    const norm = files.map((f) => f.replace(/\\/g, "/"));
    const edge = norm.filter((f) => f.includes("/supabase/functions/")).length;
    const mig = norm.filter((f) => f.includes("/supabase/migrations/")).length;
    return `${edge} edge fns, ${mig} migrations`;
  },
});
