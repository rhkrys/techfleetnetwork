#!/usr/bin/env node
// CI guard (PRD P-15 / D-19 / UC-16): forbid unguarded
// waitForLoadState("networkidle") in E2E tests. On pages with Supabase
// realtime/polling the network never goes idle, so an unguarded call burns the
// full 45s timeout per test per shard. Fix: waitForLoadState("domcontentloaded")
// or add .catch(() => {}). Line-accurate; reports file:line for each offender.
//
// Scan/fail-closed/zero-scan/evidence owned by the shared harness (_guard.mjs).
import { runScanGuard } from "./_guard.mjs";

runScanGuard({
  name: "check-no-unguarded-networkidle",
  roots: ["e2e"],
  include: /\.(ts|tsx|mjs|js)$/,
  // Scan ALL e2e files (the original had no exclude) — override the harness
  // default test-file exclude with a never-match.
  exclude: /(?!)/,
  rule(src) {
    const out = [];
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      const hit = /waitForLoadState\(\s*['"]networkidle['"]/.test(line);
      if (!hit) return;
      // Guarded if this line OR the next two chain .catch( — handles
      // multi-line `.catch(() => {})` formatting.
      const window = [line, lines[i + 1] ?? "", lines[i + 2] ?? ""].join("\n");
      if (/\.catch\s*\(/.test(window)) return;
      out.push({ line: i + 1, text: line.trim() });
    });
    return out;
  },
});
