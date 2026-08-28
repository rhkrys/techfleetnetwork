#!/usr/bin/env node
// CI guard (PRD G-03 / P-05 / UC-09): the test suite must NEVER reference the
// production Supabase project. Fails with file:line for every test file that
// references the production project ref. Static grep — no network, no DB.
// Allowed: local (127.0.0.1:54321), staging vars, env-driven URLs.
//
// Scan/fail-closed/zero-scan/evidence owned by the shared harness (_guard.mjs).
import { runScanGuard } from "./_guard.mjs";

// Production project ref — the one thing tests must not touch.
const PROD_REF = "pzvqxdgoztbfikfuifix";

runScanGuard({
  name: "check-no-prod-supabase-in-tests",
  roots: ["src", "e2e"],
  // The guard's target IS test code, so select it by PATH (function include):
  //  - any *.test/spec/e2e.* file anywhere, PLUS
  //  - every code file under e2e/ or src/test/ (their plain-named helpers/fixtures
  //    are test code too — the original scanned these dirs wholesale; a basename
  //    filter alone silently dropped ~9 of them, an undetected coverage hole).
  include: (rel) =>
    /\.(test|spec|e2e)\.(ts|tsx|mjs|js)$/.test(rel) ||
    (/\.(ts|tsx|mjs|js)$/.test(rel) && (rel.startsWith("e2e/") || rel.startsWith("src/test/"))),
  exclude: /(?!)/,
  rule(src) {
    const out = [];
    src.split("\n").forEach((line, i) => {
      if (line.includes(PROD_REF)) out.push({ line: i + 1, text: line.trim() });
    });
    return out;
  },
});
