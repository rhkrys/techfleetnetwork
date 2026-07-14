#!/usr/bin/env node
/**
 * check-no-stray-lockfiles
 *
 * npm (package-lock.json) is the ONE canonical package manager for this repo.
 * A stray foreign lockfile silently changes how the production host builds:
 * Cloudflare Pages auto-detects bun.lock and builds with bun, which cannot parse
 * package.json nested `overrides` — a single stray bun.lock froze the production
 * frontend build for 11 days while GitHub CI (npm) stayed green. The GitHub gate
 * build is NOT the same environment that serves production, so this guard exists
 * to keep the two from diverging.
 *
 * Fails the gate if any non-npm lockfile is present at the repo root.
 */
import { existsSync } from "node:fs";

const FORBIDDEN = ["bun.lock", "bun.lockb", "pnpm-lock.yaml", "yarn.lock"];
const found = FORBIDDEN.filter((f) => existsSync(f));

if (found.length > 0) {
  console.error(
    `::error::Stray non-npm lockfile(s) detected: ${found.join(", ")}. ` +
      `npm (package-lock.json) is canonical here — a foreign lockfile makes ` +
      `Cloudflare build with the wrong package manager (the bun.lock incident ` +
      `froze production for 11 days). Remove it: git rm ${found.join(" ")}`
  );
  process.exit(1);
}

console.log("OK: no stray non-npm lockfiles (package-lock.json is canonical).");
