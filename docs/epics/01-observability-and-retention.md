# Epic 01 — Member-Retention Telemetry, Stability & "Quiet Month"

**Status:** in progress (new code era, post-Lovable migration)
**Owner:** Morgan · engineering by Claude Code
**Goal in one line:** make the platform stable enough to walk away for a month —
not by chasing "zero bugs," but by making three things true:
**self-heal the known, gate the new, page only on real member-facing SLO breach.**

> Honest framing: literal "0 bugs" is not an achievable or useful target — chasing
> it is what produced the ~50-table band-aid pile this epic unwinds. The achievable,
> valuable goal is **zero member-facing incidents while unattended**, because known
> failure classes self-recover and a genuinely novel break pages you before it churns
> members.

---

## 1. Why this epic exists (measured, not hypothetical)

- **A real, dated auth-failure incident.** `failed_login_attempts` shows a baseline
  of ~8–38/week, then a spike to **219 the week of 2026-06-01** (~12×) + 78 the next
  week, back to ~10–13 by mid-June. The two spike weeks are **~64% of all failed
  logins ever recorded**. A follow-up query confirmed **52 of the 55 distinct emails
  were real members** — i.e. ~7% of the 772-user base hit repeated login failure in a
  two-week window. Not an attack; a systemic auth outage. This is retention risk #1,
  measured.
- **The telemetry grew reactively, incident-by-incident** (~50 tables; a dedicated
  `auth_wedge_events` table and a 5-minute `auth_prober` both created Jun 1–9). The
  job of this epic is to *reverse* that accretion: consolidate, then gate.
- **The "fixed" ledgers can't be trusted** (see §4). Until they can, "resolved" and
  "implemented" don't tell you what's actually safe.

---

## 2. The telemetry surface (the list)

Activity/audit: `audit_log` (the admin Activity Log page reads only this),
`triage_audit_log`, `class_audit`, `class_module_audit`, `function_grant_audit`,
`i18n_coverage_audit`.
Auth: `login_attempts` (outcome/branch/http_status/duration), `failed_login_attempts`,
`auth_wedge_events`, `auth_prober_results`, `security_events`, `revoked_sessions`,
`two_factor_login_sessions`, `passkey_login_*`.
Ops/health: `ops_events` (severity), `ops_metrics`, `system_health_state`,
`system_health_events`, `incident_response`, `error_digest_log`, `stats_drift_log`.
Errors/self-healing: `agent_fix_queue`, `known_issue_catalog`, `chunk_stale_log`,
`triage_critical_push_log`.
Email/delivery: `email_send_log`, `email_send_state`, `suppressed_emails`,
`email_domain_health`, `email_outbox`+`email_lane_state` (v2), `notification_outbox`,
`application_confirmation_outbox`.
Perf/UX: `web_vital_samples` (7-day), `lesson_video_events`, `rate_limits`.
Voice-of-customer: `feedback`, `fleety_message_feedback`.

**Critical read-the-data caveat:** `audit_log` is a *curated* sink — client errors pass
through suppression → dedup (60s) → rate-limit (10/min/tab, scaled to 10% under load)
→ escalate-after-N → severity downgrade before landing
(`src/services/error-reporter.service.ts`). Raw counts are a floor, not the true rate.
The aggregate meta-events (`client_error_overflow/suppressed/deduped`,
`audit_pressure_changed`) are the real error-volume signal, and the top-3 risks are
suppressed/downgraded *out* of `audit_log` — they live in `ops_events`,
`login_attempts`, `auth_wedge_events`, `chunk_stale_log`. Repeatable export +
rollup queries live in `scripts/activity-export.sql`.

---

## 3. Retention risks, ranked

| # | Pattern | Where it's captured | Why it threatens retention |
|---|---|---|---|
| 1 | Auth login failure / session wedging | `auth_wedge_events`, `login_attempts`, `failed_login_attempts`, `auth_prober_results` | Can't log in → instant, silent churn. **Measured** (June: 52 members). |
| 2 | Stale-bundle / blank screen | `chunk_stale_log`, `ui_chunk_load_failed` | App won't render → abandonment with no complaint. |
| 3 | DB overload (the original root cause) | `infra_transient` (downgraded to info), `ops_events` error, `system_health_events` | Everything fails at once (PGRST002 family). |
| 4 | Auth-email / reset delivery | `email_send_log`, `suppressed_emails`, `auth-email-delivery-contract` | Locked-out users can't self-recover. |
| 5 | Repeated-action / retry storms | `client_error_deduped`/`overflow`, repeated `email_hash` in `login_attempts` | Frustration + self-inflicted load. |
| 6 | Validation false-positives | `validation_rejected` (warn) | Silent "why won't it accept this" rage. |
| 7 | Performance degradation | `web_vital_samples`, `login_attempts.duration_ms`, prober latency | Slow ≈ broken for engagement. |
| 8 | Feature-level confusion | `lesson_video_events`, `feedback` | Erodes trust gradually. |

---

## 4. Verification-trust audit (the precondition)

The "fixed/implemented" ledgers were audited and cannot currently be trusted:

- **Age-based false-resolve.** `auto_resolve_stale_fix_queue()` marked stale rows
  `status='resolved'` purely by age — so a *silenced* bug auto-"resolved" 30 days later.
  → Fixed by the `dormant`-status migration (W0.3).
- **The `manual` loophole + unlinked `implemented`.** Hundreds of `bdd_scenarios` rows
  are `implemented` with no linked test; the **AUTH-CORE 29-scenario contract** appears
  in ~1 test file total. "implemented" is an unbacked claim.
- **Gates check presence, not pass, and fail-open.** bdd-gate / incident-gate verify a
  scenario row / tag exists (not that a test passes) and **skip-green** when Supabase env
  is unset — so on the migrated project they may be running as theater.

---

## 5. Wave plan → stories (with status)

Legend: ✅ done · 🟡 in flight (written, pending verify/commit) · ⬜ planned · ☁️ Cowork (human/dashboard)

### Wave 0 — Make the truth trustworthy
- ✅ **W0.1** Lockfile drift fixed (`npm ci` works again) — `4a0803f7`.
- ☁️ **W0.2** Point GitHub Actions `vars`/`secrets` at the new project `pzvqxdgoztbfikfuifix` (else DB-backed gates skip-green).
- 🟡 **W0.3a** `auto_resolve_stale_fix_queue → dormant` migration (`supabase/migrations/20260624000000_fix_queue_dormant_status.sql`) — drafted; needs Cowork to apply to live DB.
- ⬜ **W0.3b** Make `bdd-incident-gate` / `bdd-gate` fail-closed **in CI** (skip locally), with an actionable message.
- ⬜ **W0.3c** Close the `manual` loophole in `bdd-coverage` for `severity=error` scenarios.
- ⬜ **W0.4** Fix the pre-existing `auth-broker:447` eslint debt (`no-raw-password-update`) on its own.

### Wave 1 — Lock the critical flows
- ✅ **W1.1** AUTH-FLOW-LOCKDOWN suite, 6 flows — `7cee0bcf`; widened 12→22 — `90921a4c`.
- 🟡 **W1.2** MFA lockdown suite (AUTH-LOCKDOWN-08, 9 tests, green) — pending commit.
- 🟡 **W1.3** Google OAuth fix: route the single entrypoint (`GoogleSignInButton`) through native Supabase instead of the retired Lovable adapter (the 404 cause) — pending verify/commit.
- ☁️ **W1.4** Enable Google provider on new Supabase + add redirect URIs in Google Cloud + Supabase URL config (code is necessary but not sufficient without this).
- ⬜ **W1.5** Backfill real AUTH-CORE tests + relink `bdd_scenarios` so "implemented" becomes true.
- ⬜ **W1.6** Google OAuth lockdown test (AUTH-LOCKDOWN-07) — after the path stabilizes post-cutover.

### Wave 2 — Unify observability + SLO paging (the literal "walk away" mechanism)
- ⬜ **W2.1** One read model over the high-risk signals on the `ops_events`/`ops_metrics` spine (auth_wedge, chunk_stale, infra_transient, login failure-rate, email delivery).
- ⬜ **W2.2** Capture identity/IP on the auth-failure path. Root cause located:
  `src/features/auth/engine/failure-policy.ts` calls `record_failed_login` with
  `_ip: null` — the client can't know its own public IP, so every
  `failed_login_attempts.ip_address` is NULL (that's why June's attack-vs-systemic
  needed a manual check). Fix server-side: have the `record_failed_login` DB
  function derive `_ip` from `current_setting('request.headers', true)::json ->>
  'cf-connecting-ip'` when null, OR record the failure from the auth-broker edge
  function (which already sees the header). Migration + Cowork to apply.
- ⬜ **W2.3** Define member-facing SLOs (login success rate, app-load success, reset-email delivery, p95) and page **only** on breach.

### Wave 3 — Harden self-healing, then retire band-aids
- ⬜ **W3.1** Make existing recovery robust + observable: `deploy-watcher`, chunk-404 recovery (`lazy-with-retry`), `auth_wedge_events` recovery, circuit-breaker `reportRecovery`.
- ⬜ **W3.2** Remove accreted boot-time guards in `main.tsx` as their real fixes land — behind the lockdown suite.

### Wave 4 — Config-in-config + security cleanup
- ☁️/⬜ **W4.1** apex→www 301 + OAuth origin at the Cloudflare edge; then delete `enforceCanonicalHost()` + OAuth-restart machinery (per CLAUDE.md).
- 🟡 **W4.2** Captcha: code already selects the prod Turnstile key for `techfleet.network`; needs Turnstile dashboard domain allowlist + `TURNSTILE_SECRET_KEY` (Cowork). "For testing only" on the preview is by-design (test key always passes).
- ☁️ **W4.3** Delete public `migrate-helper` edge function; rotate the new DB password (pasted in chat during setup).

---

## 6. What only a human (Cowork) can do
1. GitHub Actions repo vars/secrets → new project (W0.2) — unblocks the DB-backed gates.
2. Supabase Google provider + Google Cloud redirect URIs + Supabase URL config (W1.4) — Google sign-in can't work without it.
3. Cloudflare Turnstile domain allowlist + `TURNSTILE_SECRET_KEY` secret (W4.2).
4. Apply the `dormant` migration to the live DB (W0.3a).
5. apex→www edge redirect; delete `migrate-helper`; rotate DB password (W4).

---

## 7. Definition of done for the epic
A genuinely novel break pages Morgan within minutes via an SLO breach; every known
failure class (stale bundle, wedged session, transient DB) self-recovers without
intervention; every critical flow is locked by a CI-blocking regression test that
actually runs and actually fails on regression; and "resolved" provably means
"fixed + locked by a test." That is what a quiet month is made of.
