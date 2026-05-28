# CI/CD hardening: make Regression green, fast, and a real gate

Combines the Regression failure investigation + cache/install optimization + CI/CD audit into one shipped change. Goal: stop relying on humans to catch regressions, make every PR safe to merge, and stop wasting runner minutes.

**Scope note:** `a11y-audit.yml` and `browserstack-weekly.yml` are explicitly **deferred to a later release** and not touched by this plan.

## What's there today (6 workflows in scope, 2 deferred)

| Workflow | Purpose | Triggers | Status |
|---|---|---|---|
| `regression.yml` | Lint → typecheck → build → Vitest → Playwright fast → BDD coverage → SBOM | push, PR, nightly, manual | **Failing every run (~28s)** |
| `cross-browser.yml` | Full Playwright matrix (desktop/mobile/tablet) | push, PR, nightly, manual | Overlaps with regression; likely failing |
| `lighthouse.yml` | Perf/SEO/a11y vs published preview | PR, manual | Soft-fail (uses `\|\| true`) |
| `pentest.yml` | 4 pen-test suites against deployed app | push to main, PR (security paths), nightly, manual | Hard-fails if any suite fails |
| `npm-audit.yml` | High/critical dep vulns | PR, weekly, manual | Report-only |
| `secret-scan.yml` | Blocks committed `.env`/private keys | push, PR, manual | OK |
| ~~`a11y-audit.yml`~~ | Deferred — later release | — | Untouched |
| ~~`browserstack-weekly.yml`~~ | Deferred — later release | — | Untouched |

Strengths already in place: SHA-pinned actions, concurrency cancellation on regression, CycloneDX SBOM artifact, Playwright report artifact, `scripts/bdd-coverage.ts` wired in.

## Why Regression has been red every single run

1. **`npm run test` shells out to `bun`** — workflow installs Node only, so it dies with `bun: command not found`. Primary cause of every red run.
2. **`cache: npm` only caches `~/.npm` download tarballs**, not `node_modules` — every one of the 4 jobs re-runs `npm ci` from scratch. ~3–5 min wasted per run, not a failure cause.
3. **Required `vars`/`secrets` not always set** for `bdd-coverage`/`pentest` — cryptic auth failures instead of clean skips.
4. **`regression` and `cross-browser` overlap** — same Playwright work duplicated on every push.
5. **No retries** on network-flaky steps (`npm ci`, browser install, Playwright).
6. **No `timeout-minutes`** on `regression` jobs → can hang for 6h on a bad runner.

## What's missing for real CI/CD

- No **branch protection** requiring green CI before merge → "green CI" is advisory today.
- No **CD step** — Lovable handles publish, but no PR preview-URL comment or post-deploy smoke.
- No **BDD execution gate** — coverage script runs but never asserts a threshold or fails when scenarios lack tests.
- No **failure alerting** — red `main` is invisible until someone looks.
- No **CODEOWNERS** to route failures.
- No **Playwright sharding** → E2E wall time 3× longer than needed.

---

## Phased plan (ship all phases in one go)

### Phase 1 — Stop the bleeding (get Regression green)

1. `package.json`: change `"test": "vitest run"` and `"test:watch": "vitest"` (drop the `bun run` indirection). Keep `test:unit` as a local alias so Bun users keep working.
2. Add SHA-pinned `oven-sh/setup-bun@v2` step before `npm ci` in `regression.yml`, `cross-browser.yml`, and any job whose scripts shell out to Bun (`scripts/playwright-sandbox.sh`). Belt-and-suspenders.
3. Add `timeout-minutes: 15` (vitest), `25` (playwright), `10` (others) to every job in every in-scope workflow.
4. Re-run Regression and fix the *real* next-failing step in order (lint / typecheck / build / Vitest / Playwright). Whatever errors have piled up since CI went red get cleared in this same change.

### Phase 2 — Stop wasting time (5–8× faster runs)

5. **Two-tier install caching** in every Node job:
   - `actions/cache@v4` keyed on `runner.os + hashFiles('**/package-lock.json')` covering `node_modules` AND `~/.npm`.
   - On cache hit → skip `npm ci` entirely.
   - On cache miss → `npm ci --prefer-offline --no-audit --no-fund` (30–50% faster than plain `npm ci`).
6. **Share node_modules across dependent jobs** in `regression.yml`:
   - New `setup` job: checkout → cache restore → `npm ci` if miss → `actions/upload-artifact` `node_modules.tar.zst` (tarball is ~5× faster to round-trip than uploading raw `node_modules`).
   - `vitest`, `sbom`, `bdd-coverage`, `playwright` all `needs: setup` and `download-artifact` + untar instead of `npm ci`.
7. **Cache Playwright browsers** at `~/.cache/ms-playwright` keyed on the resolved Playwright version. Skip `npx playwright install` on hit.
8. **Collapse `vitest + sbom + bdd-coverage`** into a single sequential job (same deps, no browser needed). Keep `playwright` separate (needs browsers).
9. **Playwright sharding** in `regression.yml` (`--shard=1/3`, `2/3`, `3/3` via job matrix) — cuts E2E wall time to a third.

### Phase 3 — Make failures rare and loud

10. **Graceful secret guards** at the top of `pentest` and `bdd-coverage`: if required `vars`/`secrets` are unset, log a clear "skipped — missing X" line and exit 0. Same pattern already used in the deferred workflows.
11. **Retry flaky steps** with SHA-pinned `nick-fields/retry@v3` wrapping `npm ci`, `npx playwright install`, and any HTTP-touching step. Playwright config: `retries: 2` on CI only.
12. **CI red-alert workflow** (`ci-alert.yml`): `workflow_run` trigger on `regression` + `pentest` + `cross-browser` completion. If `conclusion = failure` and `branch = main`, call the existing `discord-notify` edge function and insert into `agent_fix_queue` with `source = 'ci'` so failures surface in System Health → Triage and the daily digest. Reuses existing infrastructure.
13. **Deduplicate matrices**: `regression.yml` runs Chromium-only on every push/PR; `cross-browser.yml` runs the full matrix only nightly + manual.
14. **Soft-fail soft signals, hard-fail real gates**: keep `lighthouse` + `npm-audit` report-only, but make `regression`, `secret-scan`, and `pentest` (when its paths change) hard failures.

### Phase 4 — Turn it into a real CI/CD gate

15. **Branch protection on `main`** (documented here; user toggles in GitHub Settings → Branches): require `regression / vitest`, `regression / playwright (shard 1-3)`, `secret-scan`, `pentest` (if applicable paths). Dismiss stale reviews on push. No force-push to main.
16. **CODEOWNERS** at `.github/CODEOWNERS` routing failures: `/supabase/** @<admin>`, `/src/services/** @<admin>`, `/.github/workflows/** @<admin>`.
17. **PR preview-URL comment** (`preview-comment.yml`): on PR open/sync, post the Lovable preview URL via `actions/github-script`.
18. **Auto-rerun-on-flake** (one-shot): `workflow_run` trigger that re-runs a failed `regression` once if the failure step matches a known-flake pattern (e.g. ECONNRESET in `npm ci`). Cap at one auto-rerun to avoid loops.

### Phase 5 — BDD scenarios as enforced gates (not docs)

19. Wire `scripts/bdd-coverage.ts` to **fail the job** when coverage < 80% (configurable threshold). Write report to `$GITHUB_STEP_SUMMARY` and upload as artifact.
20. New `bdd-gate.yml` (PR-blocking): on every PR, diff against `main` for new feature code under `src/services/`, `src/pages/`, `supabase/functions/`. For each new feature, query `bdd_scenarios` via Supabase REST and **fail the PR if no scenario references the changed module**. Enforces the "every feature requires Gherkin scenarios" core memory rule mechanically.
21. Add a **scenario-runner** stub that picks BDD rows from `bdd_scenarios`, locates matching Vitest/Playwright tests via tag (`@BDD:CI-REG-001`), and reports pass/fail per scenario in the PR comment. Phased rollout — start by reporting, escalate to gating once coverage is healthy.
22. BDD scenarios for every CI change in this plan (tri-layer Then-clauses per memory rule):
    - `CI-REG-001` no bun on Node-only runner
    - `CI-CACHE-001` node_modules cache hit skips npm ci
    - `CI-SHARE-001` setup job uploads artifact, downstream jobs reuse
    - `CI-SHARD-001` Playwright sharding distributes work across 3 jobs
    - `CI-RETRY-001` transient ECONNRESET in npm ci recovers on retry
    - `CI-GUARD-001` missing pentest secrets → clean skip, not red
    - `CI-ALERT-001` red main pushes to agent_fix_queue + Discord
    - `BDD-GATE-001` PR adding a feature without a scenario fails
    - `BDD-COV-001` coverage below threshold fails the job
    - `CD-PREVIEW-001` PR receives Lovable preview URL comment

## Non-negotiables (baked in per project memory)

- Every new action SHA-pinned (OWASP CI/CD).
- Job-level `permissions: { contents: read }` unless a step needs more.
- New secrets requested via Lovable's `add_secret` tool, never committed.
- No edge function added without JWT/service-role check (the new ci-alert call reuses existing `discord-notify`, no new function needed).
- BDD rows inserted in the same migration that ships each phase.

## What this delivers

- Regression: 100% red, 28s, useless → **>95% green, ~3–5 min, blocking on `main`**.
- Runner minutes: 4× `npm ci` per run → **1× shared install**.
- Red `main` goes from invisible → **auto-posted to Discord + Triage queue**.
- PRs without BDD scenarios → **blocked at merge, not discovered in prod**.
- Every CI fix gets its own BDD scenario → **future regressions of the CI itself are caught**.

## Out of scope (explicit)

- `a11y-audit.yml` — deferred to later release.
- `browserstack-weekly.yml` — deferred to later release.
- Migrating off Bun for local dev.
- Moving Lovable Publish into GitHub Actions.
- Self-hosted or paid GitHub runners.
- Rewriting any existing Vitest/Playwright test bodies (we only change how/when they run).
