## Goal

Make every login failure observable: persist a structured row for each attempt and every failure branch, then surface a Login Health panel in the System Health dashboard so admins can see breakages in real time.

## 1. Database — login telemetry tables

New schema (migration):

- `public.login_attempts`
  - `id uuid pk`, `attempt_id uuid` (client-generated, unique per submit), `created_at timestamptz`
  - `email_hash text` (SHA-256, never raw email), `email_domain text`
  - `ip_hash text`, `user_agent_short text`, `origin_host text`
  - `outcome text` enum-like: `started | captcha_loaded | captcha_blocked | captcha_failed | edge_entered | domain_reject | auth_throttle | invalid_credentials | session_set | mfa_required | redirected | session_incomplete | network_error | server_error | stale_chunk_recovery | unknown`
  - `branch text` (mirrors edge-fn `branch` for `login-with-captcha`)
  - `http_status int`, `duration_ms int`, `request_id text`
  - `user_id uuid null` (only set on success / known account)
- `public.login_health_rollup_5m` (materialized lightweight rollup populated by trigger or cron)
  - bucket_start, outcome, count, p95_duration_ms

RLS: strict admin-only `SELECT`; inserts via `SECURITY DEFINER` RPC `record_login_event(p_attempt_id, p_outcome, p_branch, p_http_status, p_duration_ms, p_email, p_origin, p_user_agent, p_request_id, p_user_id)` granted to `anon, authenticated`. RPC hashes email/IP server-side, validates outcome, and rate-limits to ~20 events / 5 min per attempt_id to prevent abuse.

Indexes: `(created_at desc)`, `(outcome, created_at desc)`, `(email_hash, created_at desc)`.

Retention: 30 days raw, 365 days rollup. Pruning via existing nightly cron pattern.

## 2. Client telemetry — wire the events

In `src/pages/LoginPage.tsx` + `src/services/auth.service.ts` + `src/components/auth/TurnstileChallenge.tsx`, generate one `attempt_id` per submit and emit `record_login_event` (fire-and-forget, never blocks UX) at:

- form submit start → `started`
- Turnstile script ready → `captcha_loaded`
- Turnstile load watchdog tripped → `captcha_blocked`
- Turnstile error / expired callback → `captcha_failed`
- AuthService throws classified `NETWORK / SERVER / SESSION_INCOMPLETE / INVALID_CREDENTIALS / RATE_LIMITED` → matching outcome
- `setSession` + `getUser` success → `session_set`
- MFA gate opens → `mfa_required`
- navigate to redirect → `redirected`
- pre-mount stale-chunk reloader fires (in `index.html`) → queued in `sessionStorage` and flushed on next mount as `stale_chunk_recovery`

## 3. Edge telemetry — `login-with-captcha`

Add a single insert via service-role into `login_attempts` in the `finally` block, keyed by the client `attempt_id` (read from a new optional body field), recording: `branch`, `http_status`, `duration_ms`, `origin_host`, `request_id`, `email_hash`, `email_domain`. Preserves existing console ENTER/EXIT logs.

Same pattern applied to `send-magic-link` and `validate-email-domain` (outcomes `magic_link_sent` / `domain_reject` / `domain_ok`) so fallback path is observable too.

## 4. System Health dashboard — Login tab

New tab `Login` in the existing System Health page (sibling to Triage/Email/Performance):

- KPI row: 24h success rate, total attempts, p95 edge duration, unique members who failed.
- Stacked bar chart: attempts per 5-min bucket, colored by outcome.
- Branch breakdown table (AG Grid, card-default off here): outcome, count, % of total, last seen, sample request_id.
- Recent failures list (last 50): timestamp, outcome, http_status, branch, masked domain, request_id (copy button).
- Top failing domains (last 24h).
- Alert banner when any of these fire (read from the rollup, no extra polling cost):
  - success rate < 95% over last 15 min with ≥ 20 attempts
  - `captcha_blocked` > 5% of attempts
  - `server_error` or `session_incomplete` > 1% of attempts
  - zero `edge_entered` while `started` > 10 (means edge function is unreachable)

Data fetched via a new `get_login_health(p_window interval)` admin-only RPC returning KPIs + buckets + branch table in a single payload (≤ 50 KB) to keep the panel snappy.

## 5. Alerts and digests

Reuse the existing Triage daily digest + critical-push pipeline:
- New fingerprint family `login.<outcome>` written into `agent_fix_queue` when alert thresholds trip, deduped by 15-min window.
- Critical push (5-min cron) escalates `login.edge_unreachable` and `login.success_rate_low` to admin push + Discord.
- Daily digest counts login failures by branch.

## 6. BDD coverage (`bdd_scenarios`)

Add LOGIN-OBS-001..012 with tri-layer Then-clauses (UI/DB/Code), covering:
- happy path emits `started → captcha_loaded → edge_entered → session_set → redirected` [DB rows present, UI redirected, edge log shows branch=ok]
- wrong password emits `invalid_credentials` only (no extra penalty rows)
- Turnstile blocked emits `captcha_blocked` and Login Health KPI updates
- stale chunk reload emits `stale_chunk_recovery` on next mount
- admin dashboard renders Login tab with correct KPIs from seeded rows
- non-admin cannot read `login_attempts`
- alert banner appears when success rate < 95%

## 7. Privacy / security

- No raw email, password, IP, or token ever stored. Emails hashed with per-project salt; IPs hashed; UA truncated to 120 chars.
- RPC validates enum values; rejects unknown outcomes.
- RLS: `SELECT` admin-only; `INSERT` only through RPC.
- Anti-enumeration preserved: outcome rows for unknown accounts use `email_hash` only, no `user_id`.
- Retention enforced by nightly cron.

## 8. Files touched

- new: `supabase/migrations/<ts>_login_telemetry.sql`
- edit: `supabase/functions/login-with-captcha/index.ts`, `send-magic-link/index.ts`, `validate-email-domain/index.ts`
- edit: `src/pages/LoginPage.tsx`, `src/services/auth.service.ts`, `src/components/auth/TurnstileChallenge.tsx`, `index.html` (queue stale-chunk event)
- new: `src/lib/login-telemetry.ts` (single `recordLoginEvent(attemptId, outcome, extra)` helper)
- new: `src/pages/admin/system-health/LoginHealthTab.tsx` + `useLoginHealth` hook
- edit: System Health page to register the new tab
- new: BDD insert migration LOGIN-OBS-001..012
- new tests: `src/test/lib/login-telemetry.test.ts`, `src/test/ui/LoginHealthTab.test.tsx`

## Success criteria

- Every login attempt produces ≥ 1 row in `login_attempts`; failed ones produce a branch-specific row.
- Admin opens System Health → Login and sees live KPIs, bucket chart, branch table, and recent failures within ~5 s.
- Threshold breaches raise an in-app alert + Discord push within 5 min.
- Zero PII leakage verified by schema + RLS tests.
- All LOGIN-OBS BDD scenarios pass.