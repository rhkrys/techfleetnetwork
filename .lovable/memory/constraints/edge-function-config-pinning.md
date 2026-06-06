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
1. `mkdir supabase/functions/<name>` + write `index.ts` starting with one of:
   - `// @edge-auth required` → critical auth flow (pages admins on 404)
   - `// @edge-auth` → standard JWT-verified
   - `// @edge-public` → webhook/public, must validate HMAC/captcha in body
   - `// @edge-cron` → cron-poked, must call `authorizeServiceRoleRequest`
2. `git commit` — pre-commit auto-pins it with `verify_jwt = true` (override
   to `false` in `config.toml` for public/cron).
3. Manifest (`supabase/functions.manifest.json` + mirrored
   `src/generated/edge-functions.manifest.json` + smoke
   `_manifest.json`) regenerates with `{name, verify_jwt, kind, critical, declared}`.
4. `auditedInvoke` derives AUTH_CRITICAL from `manifest.functions[].critical`
   — no hand-edit. Until every dir carries `@edge-auth required`, a
   `CRITICAL_FALLBACK` set in the generator backstops the original 13.
5. Smoke cron picks the new fn up next 10-min tick.

## Magic-comment contract
- Detected in first 15 lines of `index.ts`.
- Contradiction (`@edge-public` + `verify_jwt=true`, or `@edge-auth` +
  `verify_jwt=false`) FAILS CI.
- Missing comment WARNS (109 dirs currently undeclared; backfill incremental).
  Promote to FAIL via `--strict` flag once backfilled.

## System Health surface
`/admin/system-health` → "Edge functions" tab lists every manifest entry
(name, kind, verify_jwt, critical, declared) with a "Probe now" button that
invokes `edge-deploy-smoke` and shows OK / 404 per row.

## BDD EDGE-PIN-001..006
- 001 Unpinned dir → pre-commit auto-pins.
- 002 Missing `@edge-*` comment → warn non-strict / fail strict.
- 003 Comment contradicts verify_jwt → CI fails.
- 004 Smoke 404 → severity:error audit row → Critical Push pages < 5 min.
- 005 AUTH_CRITICAL derived from manifest (no hand-edit).
- 006 Removing a dir auto-removes manifest entry on next run.
