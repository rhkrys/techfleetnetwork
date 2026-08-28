#!/usr/bin/env node
/**
 * Phase 1 chokepoint — every HTTP-serving edge function must wrap its top-level
 * handler in `withAuditWrapper` (supabase/functions/_shared/audit.ts). The wrapper
 * is the ONE place that (a) turns an uncaught throw into a structured 500 + an
 * `edge_function_error` audit row (so failures REPORT — decisions.md §4), and
 * (b) guarantees an `x-trace-id` on the request and response for correlation.
 * A function that hand-rolls `Deno.serve(handler)` without it silently drops both:
 * its crashes never reach audit_log and its logs can't be traced.
 *
 * This is a RATCHET. `ALLOWLIST` holds functions still awaiting the wrap (known
 * debt). The guard fails when:
 *   - a serving fn is NOT wrapped and NOT on the allowlist  → a new gap shipped;
 *   - a fn IS wrapped but still on the allowlist            → burn-down happened,
 *                                                             shrink the allowlist;
 *   - a wrapped fn's label != its directory name            → audit rows mis-keyed.
 * The allowlist may only shrink. Scan/fail-closed/zero-scan/evidence are owned by
 * the shared harness (_guard.mjs).
 */
import { runScanGuard } from "./_guard.mjs";

// Functions still awaiting the wrap. MUST only shrink — never add a name here to
// silence the gate for new code. Empty = 100% coverage enforced.
const ALLOWLIST = new Set([]);

// Strip block + line comments so a commented-out `Deno.serve` / stale `withAuditWrapper`
// reference can't fool the presence checks. The `[^:]` guard avoids eating `https://`.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

let served = 0;
let wrappedCount = 0;
let debtCount = 0;

runScanGuard({
  name: "check-edge-audit-wrapper-coverage",
  roots: ["supabase/functions"],
  // Only the top-level entrypoint of each function: supabase/functions/<name>/index.ts,
  // excluding shared/underscore dirs. Path-aware include (function form).
  include: (rel) => {
    const m = rel.match(/^supabase\/functions\/([^/]+)\/index\.ts$/);
    return !!m && !m[1].startsWith("_");
  },
  rule(src, rel) {
    const name = rel.split("/")[2];
    const code = stripComments(src);

    const serves = /\bDeno\.serve\s*\(/.test(code) || /(?:^|[^\w.])serve\s*\(/m.test(code);
    if (!serves) return []; // not an HTTP entrypoint — nothing to wrap

    served++;
    const onAllow = ALLOWLIST.has(name);

    // The wrapper must be the DIRECT handler argument to the server call, i.e.
    // `serve(withAuditWrapper(...))` — optionally after a Deno.serve options object
    // (`serve({ ... }, withAuditWrapper(...))`). We deliberately do NOT accept
    // "withAuditWrapper appears somewhere in the file": a file could wrap an inner
    // sub-handler while serving a RAW top-level handler, which would be unaudited.
    // Requiring adjacency makes "the entrypoint is wrapped" structurally verifiable
    // rather than inferred — no false green.
    const directlyWrapped =
      /(?:\bDeno\.serve|(?:^|[^\w.])serve)\s*\(\s*(?:\{[\s\S]*?\}\s*,\s*)?withAuditWrapper\s*\(/m.test(
        code
      );
    const wrapperPresentSomewhere = /\bwithAuditWrapper\s*\(/.test(code);

    // Present but NOT wrapping the entrypoint: fail CLOSED toward human review —
    // never silently pass. (Zero occurrences today; this keeps it that way.)
    if (!directlyWrapped && wrapperPresentSomewhere) {
      return [
        {
          text: `imports/calls withAuditWrapper but it is not the direct handler passed to Deno.serve/serve — the gate cannot confirm the ENTRYPOINT is wrapped (an inner sub-handler may be wrapped while the top-level handler runs raw and unaudited). Inline it: Deno.serve(withAuditWrapper("${name}", handler)).`,
        },
      ];
    }

    if (directlyWrapped) {
      wrappedCount++;
      const label = code.match(/\bwithAuditWrapper\s*\(\s*["'`]([^"'`]+)["'`]/);
      if (label && label[1] !== name) {
        return [
          {
            text: `wraps withAuditWrapper("${label[1]}") but the label must equal the function directory name "${name}" — audit rows are keyed by it, so a wrong label hides this fn's errors under another name.`,
          },
        ];
      }
      if (onAllow) {
        return [
          {
            text: `now wraps withAuditWrapper — remove "${name}" from ALLOWLIST in scripts/ci/check-edge-audit-wrapper-coverage.mjs so the ratchet shrinks.`,
          },
        ];
      }
      return [];
    }

    // Not wrapped.
    if (onAllow) {
      debtCount++;
      return []; // known, tracked debt
    }
    return [
      {
        text: `top-level Deno.serve/serve handler is not wrapped in withAuditWrapper — uncaught throws won't be audited and no x-trace-id is propagated. Wrap it: Deno.serve(withAuditWrapper("${name}", handler)) and import it from "../_shared/audit.ts".`,
      },
    ];
  },
  summary: () =>
    `${wrappedCount}/${served} HTTP edge functions wrap withAuditWrapper` +
    (debtCount
      ? `; ${debtCount} known-debt awaiting wrap (ALLOWLIST)`
      : "; 0 debt — full coverage"),
});
