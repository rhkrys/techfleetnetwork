#!/usr/bin/env node
// CI guard: enforces email subsystem v2 layering.
//   Domain MUST NOT import infrastructure/providers/Deno/npm I/O.
//   Application MUST NOT import infrastructure directly (only ports).
// Scan/fail-closed/zero-scan/evidence owned by the shared harness (_guard.mjs),
// which also normalizes paths to forward slashes so the /domain//application/
// classification is correct on every OS (it silently mis-read 0/0 on Windows before).
import { runScanGuard } from "./_guard.mjs";

const FORBIDDEN_IN_DOMAIN = [
  /from\s+['"]npm:@supabase/,
  /from\s+['"]npm:@lovable\.dev/,
  /from\s+['"]npm:@react-email/,
  /Deno\./,
  /fetch\(/,
];
const FORBIDDEN_IN_APPLICATION = [
  /from\s+['"]\.\.\/infrastructure/,
  /from\s+['"]npm:@supabase/,
  /from\s+['"]npm:@lovable\.dev/,
];

runScanGuard({
  name: "check-email-architecture",
  roots: ["supabase/functions/_shared/email"],
  include: /\.(ts|tsx)$/,
  exclude: /\.test\.ts$/,
  rule(src, rel) {
    // Strip comment lines so an import in a comment doesn't trip the check.
    const code = src
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    const out = [];
    if (rel.includes("/domain/")) {
      for (const re of FORBIDDEN_IN_DOMAIN)
        if (re.test(code)) out.push({ text: `[domain] forbidden import/IO: ${re}` });
    } else if (rel.includes("/application/")) {
      for (const re of FORBIDDEN_IN_APPLICATION)
        if (re.test(code)) out.push({ text: `[application] forbidden import: ${re}` });
    }
    return out;
  },
  summary: (_n, files) => {
    const norm = files.map((f) => f.replace(/\\/g, "/"));
    const d = norm.filter((f) => f.includes("/domain/")).length;
    const a = norm.filter((f) => f.includes("/application/")).length;
    return `${d} domain, ${a} application`;
  },
});
