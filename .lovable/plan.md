## Why it broke "magically"

Nothing changed in the code at the moment of the outage. The trap was set months ago and tripped when the Supabase platform tightened deploy behavior so that functions **without** an explicit `[functions.<name>]` block stopped being deployed at all (previously they deployed with platform defaults — `verify_jwt=true`, latest runtime, etc.).

Our CI guard already required every function dir to be pinned **OR** be on a hand-curated `BASELINE_DEFAULT_FUNCTIONS` allow-list. That allow-list was meant for a handful of throwaway cron jobs, but over ~6 months it grew to a parking lot of ~21 names — including (until this turn) auth-critical ones like `update-password-confirmed`, `login-with-captcha`, `send-magic-link`, `delete-account`. CI stayed green, no migration touched these dirs, and the platform silently stopped shipping them. Symptom surfaced only when a member clicked "Update password" and supabase-js got a 404 with no body.

Today there are still **21** dirs sitting on that allow-list. They're not auth-critical, but they're the next outage if the platform tightens again.

## Refactor goals

1. Make "function dir exists but is not pinned" literally impossible — not just CI-failable.
2. Eliminate the allow-list as a concept. Zero parking-lot escape hatches.
3. Catch a deploy regression in minutes, not days, even if CI is bypassed.
4. Keep authoring a new edge function a one-step task (no manual TOML editing).

## Plan

### 1. Delete the allow-list, full stop
- Remove `BASELINE_DEFAULT_FUNCTIONS` from `scripts/ci/check-edge-function-coverage.mjs`. The check becomes: every dir under `supabase/functions/` (except `_shared/`) MUST have a `[functions.<name>]` block. No exceptions, no auth-critical sub-list needed (everything is critical now).
- Pin the 21 currently-unpinned dirs in `supabase/config.toml` in the same migration as the guard tightening, with `verify_jwt = true` unless the function is explicitly webhook/public (cron-only stays `verify_jwt = false` and is invoked with the service-role key — listed explicitly).

### 2. Auto-pin generator + pre-commit hook
- New script `scripts/ci/pin-edge-functions.mjs`:
  - Scans `supabase/functions/*/index.ts`.
  - For each missing dir, appends a `[functions.<name>]` block to `config.toml` with a default of `verify_jwt = true`.
  - Detects webhook/cron functions by a magic comment at the top of `index.ts` (`// @edge-public` or `// @edge-cron`) and sets `verify_jwt = false` for them.
  - Sorts blocks alphabetically and rewrites the `[functions]` section deterministically.
- Wire into Husky `pre-commit` (existing) so anyone creating a new function dir cannot land a commit without the block.
- `--check` mode runs in CI as the new coverage guard (diff = fail).

### 3. Magic-comment contract for `verify_jwt`
- The first ~5 lines of every `supabase/functions/<name>/index.ts` must declare intent:
  - `// @edge-auth required` → `verify_jwt = true` (default)
  - `// @edge-public` → `verify_jwt = false`, must be paired with HMAC/captcha/webhook validation in the body (we already do this).
  - `// @edge-cron` → `verify_jwt = false`, must call `authorizeServiceRoleRequest` (existing helper).
- Generator reads this and writes the matching block. CI fails if the comment is missing or contradicts the config.

### 4. Post-deploy smoke test (catches platform drift in minutes)
- New edge fn `edge-deploy-smoke` (or extend `email-pipeline-health`) runs on a 10-min cron:
  - For every dir in `supabase/functions/`, sends a `OPTIONS` request to the function URL.
  - A 404 = "not deployed" → write `severity:'error'` row to `agent_fix_queue` with `fingerprint:'edge_function_404:<name>'`.
  - Triage Critical Push (existing 5-min cron) pages admins on first occurrence.
- This is the safety net for the next time the platform changes behavior — we find out in <15 min, not after a member complaint.

### 5. Single source of truth: function manifest
- Generated file `supabase/functions.manifest.json` (committed, written by the generator) listing every function with `{name, verify_jwt, kind: public|auth|cron}`.
- `audited-invoke.ts` reads it at build time to populate the `AUTH_CRITICAL` set automatically (today it's a hand-maintained literal — same parking-lot risk).
- Smoke test, CI guard, and the System Health "Edge Functions" tab all read the same manifest. One file, one truth.

### 6. Observability surface
- New System Health > "Edge Functions" tab: lists every function from the manifest with last-seen-deployed timestamp (from edge logs), last invocation, last error, and a "Probe now" button. Green/red badge at a glance.

### 7. BDD scenarios EDGE-PIN-001..006
- New function dir without a pin → pre-commit blocks commit.
- New function dir without a `@edge-*` comment → pre-commit blocks commit.
- Function returns 404 from smoke → triage row written, admin paged within 5 min.
- Manifest drift (dir exists, manifest missing) → CI fails.
- `audited-invoke` AUTH_CRITICAL list derived from manifest (no hand-edit needed).
- Removing a dir auto-removes the config block and the manifest entry.

## Out of scope
- Email/auth wedge/session work (already permanently shipped).
- Migrating cron functions off `verify_jwt=false` (separate hardening track).

## Expected outcome
Adding a new edge function is one step (create the dir + `// @edge-auth required` comment). The generator pins it, the manifest lists it, CI enforces it, and the smoke cron tells us within 10 minutes if the platform ever stops shipping it. The exact failure mode that bricked `update-password-confirmed` for an unknown number of weeks becomes structurally impossible — there is no allow-list to hide on.