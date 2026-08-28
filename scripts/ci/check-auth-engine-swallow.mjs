#!/usr/bin/env node
/**
 * AUTH-ARCH-CUTOVER-011 — fail CI if any auth engine catch block swallows an
 * error without recording telemetry. Prevents the silent reset-email outage
 * class (June 11–15, 2026) from recurring.
 *
 * Heuristic: every `catch (...) { ... }` body under src/features/auth/engine must
 * call `telemetryPort.record(` or `telemetryPort.captcha(`.
 *
 * Scan/fail-closed/zero-scan/evidence are owned by the shared harness (_guard.mjs).
 */
import { runScanGuard, lineOf } from "./_guard.mjs";

runScanGuard({
  name: "check-auth-engine-swallow",
  roots: ["src/features/auth/engine"],
  include: /\.(ts|tsx)$/,
  exclude: /\.test\.(ts|tsx)$/,
  rule(src) {
    const out = [];
    const re = /catch\s*\([^)]*\)\s*\{/g;
    let m;
    while ((m = re.exec(src))) {
      const start = m.index + m[0].length;
      let depth = 1;
      let i = start;
      while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        i++;
      }
      const body = src.slice(start, i - 1);
      if (!/telemetryPort\.(record|captcha)\s*\(/.test(body)) {
        out.push({
          line: lineOf(src, m.index),
          text: 'catch block without telemetryPort.record/captcha — add telemetryPort.record("auth_engine.*_failed", {...}) (AUTH-ARCH-CUTOVER-011).',
        });
      }
    }
    return out;
  },
});
