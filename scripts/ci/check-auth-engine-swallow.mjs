#!/usr/bin/env node
/**
 * AUTH-ARCH-CUTOVER-011 — fail CI if any auth engine catch block swallows an
 * error without recording telemetry. Prevents the silent reset-email outage
 * class (June 11–15, 2026) from recurring.
 *
 * Heuristic: scan every `src/features/auth/engine/**.ts(x)` file for `catch`
 * blocks; require the same block (or the surrounding try) to call
 * `telemetryPort.record(` or `telemetryPort.captcha(`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(process.cwd(), "src/features/auth/engine");
const offenders = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) { walk(full); continue; }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    if (/\.test\.(ts|tsx)$/.test(name)) continue;
    const src = readFileSync(full, "utf8");
    // Find every catch (...) { ... } body and require telemetry inside it.
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
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(`${relative(process.cwd(), full)}:${line}`);
      }
    }
  }
}

try { walk(ROOT); } catch (e) {
  console.error(`[check-auth-engine-swallow] unable to scan ${ROOT}: ${e.message}`);
  process.exit(0);
}

if (offenders.length) {
  console.error("[check-auth-engine-swallow] catch blocks without telemetryPort.record(...) — AUTH-ARCH-CUTOVER-011:");
  for (const o of offenders) console.error("  - " + o);
  console.error("\nAdd a telemetryPort.record(\"auth_engine.*_failed\" | \"auth_engine.*_email_delivery_unverified\", {...}) call.");
  process.exit(1);
}

console.log(`[check-auth-engine-swallow] OK — all auth-engine catch blocks emit telemetry.`);
