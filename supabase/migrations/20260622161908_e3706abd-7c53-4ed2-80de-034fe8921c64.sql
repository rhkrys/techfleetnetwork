INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, test_file, notes) VALUES
('Infrastructure Resilience — PostgREST Schema Cache', 70010, 'INFRA-PGRST002-RETRY-001',
 'PGRST002 schema-cache reload is retried transparently',
 'Feature: Universal transient retry for PostgREST calls
  Scenario: A single PGRST002 blip during a schema cache reload recovers silently
    Given the PostgREST proxy returns PGRST002 once for a SELECT on journey_progress
    When JourneyService.getCompletedCount runs for a member
    Then [UI] the dashboard renders the correct numeric count (not zero, not an error toast)
    And [DB] the underlying SELECT is re-issued and returns rows
    And [Code] withTransientRetry classifies PGRST002 as transient and emits zero [ERROR] log lines',
 'implemented', 'unit', 'src/test/lib/transient-retry.test.ts',
 'Locks issue #1 from the 2026-06-22 production log. Also covered by journey.service.transient-retry.test.ts.'),

('Infrastructure Resilience — PostgREST Schema Cache', 70010, 'INFRA-PGRST002-RETRY-002',
 'Persistent 503 surfaces exactly one degraded WARN per service',
 'Feature: Universal transient retry for PostgREST calls
  Scenario: When 503 persists past the retry budget the service degrades gracefully
    Given the PostgREST proxy returns 503 for every attempt
    When JourneyService.getCompletedCount runs for a member
    Then [UI] the progress widget shows the last cached value (no error toast, no flicker)
    And [DB] no rows are written and audit_log records no error
    And [Code] exactly one [WARN] log line is emitted per phase, never an [ERROR]',
 'implemented', 'unit', 'src/test/services/journey.service.transient-retry.test.ts',
 'Graceful-degrade semantics — TRIAGE-NOISE-015 also enforces no triage queue entries.'),

('Authentication — Web Locks Contention', 70011, 'AUTH-LOCK-RETRY-001',
 'ProfileService.fetch retries once on AbortError: Lock broken',
 'Feature: GoTrue Web Lock contention recovery
  Scenario: A parallel auth call steals the lock during identity bootstrap
    Given MfaService.getMfaGateDecision is in flight holding the GoTrue Web Lock
    When ProfileService.fetch races for the same lock and receives "AbortError: Lock broken by another request with the steal option"
    Then [UI] the dashboard still hydrates with the member''s profile on first paint
    And [DB] no profile rows are mutated; the SELECT is replayed unchanged
    And [Code] withAuthLockRetry sleeps 50ms and retries the wrapped fn exactly once',
 'implemented', 'unit', 'src/test/services/profile.service.lock-retry.test.ts',
 'Locks issue #2. Pattern matches /Lock broken by another request|lock ''lock:sb-/.'),

('Authentication — Web Locks Contention', 70011, 'AUTH-LOCK-RETRY-002',
 'React Query identity-scoped keys dedupe parallel bootstrap fetches',
 'Feature: Identity-scoped query keys prevent duplicate auth-lock contention
  Scenario: Dashboard + announcements + MFA gate all bootstrap in parallel
    Given the user signs in and the dashboard mounts
    When useDashboardOverview, useCompletedCount, useLatestAnnouncements, useProfile, and useMfaGate all run on the same render
    Then [UI] each hook resolves without surfacing "Lock broken" errors
    And [DB] each underlying RPC/SELECT fires at most once per identity per dedupe window
    And [Code] queryKey is prefixed ["identity", userId, …] so React Query dedupes parallel callers',
 'implemented', 'unit', 'src/test/services/profile.service.lock-retry.test.ts',
 'Companion to AUTH-LOCK-RETRY-001 — dedupe is the upstream prevention, withAuthLockRetry is the downstream cure.'),

('Authentication — MFA Resilience', 70012, 'AUTH-MFA-NO-PRECREATE-001',
 'MfaChallengeDialog does NOT pre-create a challenge on open',
 'Feature: Resilient MFA challenge dialog
  Scenario: Opening the dialog must not call /factors/<id>/challenge
    Given a member with a verified TOTP factor is prompted for 2FA
    When MfaChallengeDialog mounts (open=true)
    Then [UI] the dialog renders the 6-digit input within 250ms without spinner flicker
    And [DB] no auth_factor_challenge row is created until the member clicks Verify
    And [Code] MfaService.createChallenge is never invoked on open; only challengeAndVerifyResilient runs on Verify',
 'implemented', 'unit', 'src/test/ui/MfaChallengeDialog.no-precreate.test.tsx',
 'Root-cause fix for the "Invalid TOTP" loop on correct codes (issue #3, 2026-06-22).'),

('Authentication — MFA Resilience', 70012, 'AUTH-MFA-RESILIENT-504-001',
 'Single 504 from GoTrue /challenge is retried; verification succeeds with the same code',
 'Feature: Resilient MFA challenge-and-verify
  Scenario: GoTrue returns 504 once for the challenge phase
    Given the GoTrue /factors/<id>/challenge endpoint returns 504 once
    And the member has entered the correct 6-digit TOTP code
    When MfaService.challengeAndVerifyResilient runs
    Then [UI] the success toast "Verified — welcome back!" appears (not "invalid code")
    And [DB] the user''s session is elevated to AAL2 in auth.sessions
    And [Code] supabase.auth.mfa.challengeAndVerify is invoked exactly twice with the same user code, second call resolves',
 'implemented', 'unit', 'src/test/services/mfa.service.resilient.test.ts',
 'Backed by 2-retry/400/1500ms backoff in MfaService with 20s AbortController ceiling.'),

('Authentication — MFA Resilience', 70012, 'AUTH-MFA-422-NO-RETRY-001',
 '422 Invalid TOTP code is NOT silently retried',
 'Feature: Resilient MFA challenge-and-verify never burns TOTP attempts on real wrong codes
  Scenario: GoTrue returns 422 "Invalid TOTP code entered"
    Given the GoTrue verify endpoint returns 422 invalid_code
    And the member entered an incorrect 6-digit code
    When MfaService.challengeAndVerifyResilient runs
    Then [UI] the friendly toast "That 6-digit code didn''t match. Open your authenticator and enter the newest code." appears
    And [DB] no extra mfa_amr_claims row is written; the rate-limit counter increments by exactly one
    And [Code] supabase.auth.mfa.challengeAndVerify is invoked exactly once and throws MfaInvalidCodeError immediately',
 'implemented', 'unit', 'src/test/services/mfa.service.resilient.test.ts',
 'shouldRetry classifier never returns true for MfaInvalidCodeError.'),

('Authentication — MFA Resilience', 70012, 'AUTH-MFA-TRANSIENT-PRESERVES-INPUT-001',
 'Transient MFA error preserves the typed digits',
 'Feature: Resilient MFA dialog UX
  Scenario: Member sees a transient 504, retries without retyping
    Given the member has typed 6 digits and clicked Verify
    And challengeAndVerifyResilient throws MfaTransientError
    When the error toast appears
    Then [UI] the 6 digits remain visible in the InputOTP; the member can re-click Verify immediately
    And [DB] no auth tables are mutated
    And [Code] setCode("") is only called for MfaInvalidCodeError, never for MfaTransientError or MfaSessionEscalationError',
 'implemented', 'unit', 'src/test/ui/MfaChallengeDialog.no-precreate.test.tsx',
 'UX rule from the 2026-06-22 incident: a still-valid code must not be wiped on infra blips.'),

('RUM — Beacon Resilience', 70013, 'RUM-BEACON-BLOCKED-001',
 'ad-blocker rejection of sendBeacon is silently swallowed',
 'Feature: Web vitals reporter never surfaces network noise to the user
  Scenario: uBlock/Brave Shields blocks the record-web-vital beacon
    Given navigator.sendBeacon returns false OR throws ERR_BLOCKED_BY_CLIENT
    When the web-vitals flush() runs
    Then [UI] no console.error is emitted and no toast surfaces
    And [DB] zero rows are written to web_vital_samples for this flush
    And [Code] flush() falls back to fetch with keepalive:true, mode:no-cors, credentials:omit and swallows any rejection',
 'implemented', 'unit', 'src/test/lib/web-vitals-blocked.test.ts',
 'Closes issue #5 noise from the 2026-06-22 log.'),

('Build Hygiene — Preload Tags', 70014, 'BUILD-PRELOAD-HYGIENE-001',
 'Every <link rel=preload> has `as` and a real on-disk target',
 'Feature: Built index.html contains zero preload-without-as
  Scenario: CI smoke + unit test guard the preload contract
    Given the production build emits dist/index.html
    When scripts/post-build-smoke.mjs and src/test/build/index-html-preloads.test.ts run
    Then [UI] the browser never logs "<link rel=preload> not used" warnings
    And [DB] no behavior change; this is a build-output contract only
    And [Code] both the CI smoke and the unit test fail the build if any preload lacks `as` or points at a missing asset',
 'implemented', 'unit', 'src/test/build/index-html-preloads.test.ts',
 'Closes issue #6 (22× preload warnings) from the 2026-06-22 log.'),

('PWA — Meta Aliasing', 70015, 'PWA-META-ALIAS-001',
 'Both apple-mobile-web-app-capable and mobile-web-app-capable are declared',
 'Feature: PWA meta-tag cross-browser coverage
  Scenario: index.html declares both legacy and modern PWA capability meta tags
    Given Chrome 105+ deprecated the apple-prefixed meta
    When the document is served
    Then [UI] no "<meta name=apple-mobile-web-app-capable> is deprecated" console notice appears
    And [DB] no behavior change; this is an HTML contract only
    And [Code] index.html contains BOTH <meta name=apple-mobile-web-app-capable content=yes> and <meta name=mobile-web-app-capable content=yes>',
 'implemented', 'unit', 'src/test/build/index-html-preloads.test.ts',
 'Closes issue #7 from the 2026-06-22 log.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title,
  gherkin = EXCLUDED.gherkin,
  status = EXCLUDED.status,
  test_type = EXCLUDED.test_type,
  test_file = EXCLUDED.test_file,
  notes = EXCLUDED.notes,
  updated_at = now();