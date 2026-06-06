---
name: Edge Function Config Pinning (Zero-Tolerance)
description: Every edge fn dir must be pinned in config.toml; no allow-list; auto-pin pre-commit + 10-min deploy-smoke cron
type: constraint
---

# Edge Function Config Pinning — Zero-Tolerance

## Rule
Every directory under `supabase/functions/` (except `_shared/`) MUST have an
explicit `[functions.<name>]` block in `supabase/config.toml`. No allow-list.
No baseline. No escape hatch. Defaults to `verify_jwt = true`.

## Enforcement (layered)

1. **Pre-commit hook** (`.husky/pre-commit`) runs
   `node scripts/ci/check-edge-function-coverage.mjs --fix` which auto-appends
   pin blocks for any new dir and re-stages `config.toml` +
   `functions.manifest.json`. Then the check runs in verify mode.
2. **CI guard** (`scripts/ci/check-edge-function-coverage.mjs`) fails the
   build if any dir is unpinned or any `src/` `functions.invoke("<name>")`
   call references an unpinned dir.
3. **Manifest** (`supabase/functions.manifest.json`) is the single source of
   truth — written by the generator, mirrored into
   `supabase/functions/edge-deploy-smoke/_manifest.json`.
4. **Deploy smoke cron** — `edge-deploy-smoke` runs every 10 min
   (cron job `edge-deploy-smoke-10min`), OPTIONS-probes every function in
   the manifest, and writes `severity:error` audit_log rows with
   `fingerprint:edge_function_404:<name>` on 404 / transport error. The
   existing Triage Critical Push (5-min cron) pages admins within minutes.
5. **Audited-invoke** still escalates 404s on `AUTH_CRITICAL` functions to
   `severity:error` at runtime (defense-in-depth).

## Why
The previous `BASELINE_DEFAULT_FUNCTIONS` allow-list grew over ~6 months into
a parking lot of ~21 names — including auth-critical ones like
`update-password-confirmed`. When the Supabase platform tightened deploy
behavior so unpinned functions stopped shipping at all, the outage surfaced
only as a generic "We couldn't update your password" error with no audit
trail. Removing the allow-list makes that class of incident structurally
impossible; the smoke cron is the safety net for the next platform change.

## How to add a new edge function
1. `mkdir supabase/functions/<name>` + write `index.ts`.
2. `git commit` — pre-commit auto-pins it with `verify_jwt = true`.
3. If it's a webhook/cron, flip to `false` in `config.toml`.
4. Manifest + smoke cron pick it up automatically.

## BDD EDGE-PIN-001..005
- New dir without pin → pre-commit auto-pins and stages.
- Unpinned dir reaches CI → red build.
- Function returns 404 from smoke → severity:error audit row, admin paged < 15 min.
- Manifest drift → CI regenerates and stages on commit.
- `src/` invokes unpinned dir → CI fails.
