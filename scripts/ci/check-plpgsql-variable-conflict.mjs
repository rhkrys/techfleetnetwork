#!/usr/bin/env node
// Fails CI when a new/edited plpgsql function in supabase/migrations declares
// RETURNS TABLE (...) without `#variable_conflict use_column` at the top of the
// body. Postgres OUT-parameter names shadow column references, raising
// `column reference "X" is ambiguous` at call time (get_refactor_kpis incident,
// 2026-06-04). Escape hatch: `-- @safe-variable-conflict` on the line immediately
// before the function when shadowing is manually proven impossible.
//
// Scan/fail-closed/zero-scan/evidence owned by the shared harness (_guard.mjs).
import { runScanGuard } from "./_guard.mjs";

// Migrations on/before this stamp are immutable, backfilled history — grandfathered.
// Only post-cutoff migrations must ship the directive (a re-definition of an old
// function is still enforced — exactly where a regression could land).
const BASELINE_CUTOFF = "20260604170800";
const BODY_RE = /\bAS\s+(\$[A-Za-z_]*\$)([\s\S]*?)\1/; // AS $tag$ <body> $tag$

let functionsInspected = 0;

runScanGuard({
  name: "check-plpgsql-variable-conflict",
  roots: ["supabase/migrations"],
  include: /\.sql$/,
  exclude: /(?!)/, // .sql migrations only; nothing to test-exclude
  rule(sql, rel) {
    const stamp = (rel.split("/").pop() ?? "").slice(0, 14);
    if (stamp <= BASELINE_CUTOFF) return []; // immutable history — grandfathered
    // Per-FUNCTION block detection: split into CREATE FUNCTION blocks and inspect
    // each in isolation so lazy gaps can't span function boundaries.
    const createRe =
      /(--[ \t]*@safe-variable-conflict[ \t]*\r?\n)?[ \t]*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([^\s(]+)/gi;
    const starts = [];
    let cm;
    while ((cm = createRe.exec(sql)) !== null) {
      starts.push({ index: cm.index, safe: !!cm[1], name: cm[2] });
    }
    const out = [];
    for (let i = 0; i < starts.length; i++) {
      const s = starts[i];
      const end = i + 1 < starts.length ? starts[i + 1].index : sql.length;
      const block = sql.slice(s.index, end);
      const bodyMatch = BODY_RE.exec(block);
      const header = bodyMatch ? block.slice(0, bodyMatch.index) : block;
      if (!/RETURNS\s+TABLE\s*\(/i.test(header)) continue;
      if (!/\bLANGUAGE\s+plpgsql\b/i.test(header)) continue;
      functionsInspected++;
      if (s.safe) continue;
      const body = bodyMatch ? bodyMatch[2] : "";
      if (/#variable_conflict\s+use_column/i.test(body)) continue;
      out.push({
        text: `function ${s.name} RETURNS TABLE(...) but is missing '#variable_conflict use_column' as the first line of the body — see docs/runbooks/plpgsql-variable-conflict.md.`,
      });
    }
    return out;
  },
  summary: () => `${functionsInspected} RETURNS TABLE plpgsql function(s) inspected`,
});
