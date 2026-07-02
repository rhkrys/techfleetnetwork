// Smoke-tier regression for edge-function stack-trace / error-detail exposure
// (EDGE-TRACE-001..). PR #54 replaced raw error leakage in nine edge functions
// with server-side console.error logging + generic client responses. These
// functions run in Deno and are not exercised by the jsdom/Vitest runtime, so
// coverage is source-level: we read each index.ts and assert the leak patterns
// stay gone and that server-side logging is present. This is also the BDD-gate
// (D-13) coverage reference for each changed module path.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Module paths are spelled out in full so the BDD gate's per-module grep
// (supabase/functions/<name>) matches this file.
const FUNCTIONS = [
  "supabase/functions/airtable-diag/index.ts",
  "supabase/functions/auth-broker/index.ts",
  "supabase/functions/refresh-community-events/index.ts",
  "supabase/functions/replay-dlq-emails/index.ts",
  "supabase/functions/resend-signup-confirmations/index.ts",
  "supabase/functions/send-project-blast/index.ts",
  "supabase/functions/sync-airtable-network-stats/index.ts",
  "supabase/functions/translate-bundle/index.ts",
  "supabase/functions/triage-error/index.ts",
] as const;

// auth-broker never logs raw errors: it maps every provider error to an opaque
// code (invalid_credentials, rate_limited, …) and returns that, which is a
// stronger no-leak posture than console.error. So it is exempt from the
// server-side-logging assertion but still subject to the leak assertion.
const OPAQUE_CODE_FUNCTIONS = new Set(["supabase/functions/auth-broker/index.ts"]);

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

// Patterns that put a raw error string/message/stack into a client-visible
// response body. Validation feedback (parsed.error.flatten()) and AI response
// fields (aiJson…message.content) are intentionally excluded — they are not
// exception detail.
const LEAK_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "detail: <err>.message", re: /detail:\s*\w*[Ee]rr\w*\.message/ },
  { label: "detail: msg", re: /detail:\s*msg\b/ },
  { label: "error: String(e...)", re: /error:\s*String\(\s*e/ },
  { label: "detail: String(e...)", re: /detail:\s*String\(\s*e/ },
  { label: "error: <err>.message", re: /\berror:\s*\w*[Ee]rr\w*\.message\b/ },
  { label: "response .stack exposure", re: /(detail|error|message)\s*:\s*[^,\n]*\.stack\b/ },
];

describe("Edge-function stack-trace exposure (smoke)", () => {
  for (const rel of FUNCTIONS) {
    describe(rel, () => {
      const src = read(rel);

      it(`EDGE-TRACE: does not leak raw exception detail in responses`, () => {
        const hits = LEAK_PATTERNS.filter((p) => p.re.test(src)).map((p) => p.label);
        expect(hits, `leaked error detail in ${rel}: ${hits.join(", ")}`).toEqual([]);
      });

      if (!OPAQUE_CODE_FUNCTIONS.has(rel)) {
        it(`EDGE-TRACE: logs errors server-side via console.error`, () => {
          expect(src).toMatch(/console\.error\(/);
        });
      }
    });
  }
});
