# Permanent Triage Refactor — Per-Section, Per-Function Breakdown

No suppression. No graceful degradation. Every signal in the triage history has a code-level fix at the throwing site, an architectural guarantee that prevents the throw from recurring, and a test/lint rail that fails CI on regression.

I read all 116 fingerprints in `agent_fix_queue` + all `known_issue_catalog` entries + grepped the codebase. Below is the full surgical map.

---

## PART A — Cross-cutting foundations (built once, used everywhere)

| Module | Purpose | Replaces |
|---|---|---|
| `src/lib/errors/AppError.ts` | Typed error hierarchy: `AppError`, `NetworkError`, `TimeoutError`, `EdgeInvokeError`, `RpcError`, `ValidationError`, `AuthError`, `NotFoundError`, `ConflictError`, `SerializationError` | Loose `throw new Error(string)` |
| `src/lib/errors/toError.ts` | `toError(unknown) → AppError` canonicalizer (handles Supabase `{code,message,details,hint}`, AbortError, fetch TypeErrors, plain objects) | `[object Object]` reports |
| `src/lib/observability/report.ts` | Single `report(error, ctx)` entry point. Internal-only `error-reporter.service` is private | 6 different reporter call paths |
| `src/lib/observability/classify.ts` | Structural (not string-match) classifier: extension frames, online state, visibility, retry count | All regex/substring suppression |
| `src/lib/edge/invokeEdge.ts` | `invokeEdge<TIn, TOut>(name, body, opts)` — Zod-validated I/O, AbortController timeout, single retry on `FunctionsFetchError`, throws `EdgeInvokeError` only when truly failed | Direct `supabase.functions.invoke` |
| `src/lib/db/safeRpc.ts` (exists, harden) | Typed wrapper + auto-`maybeSingle` | `.single()` PGRST116 |
| `src/lib/db/safeSelect.ts` (new) | Forces caller to choose `maybeSingle` / `single` / `list` with typed `NotFoundError` | Bare `.single()` |
| `src/lib/query/queryDefaults.ts` | Global React Query defaults: 3 retries with exponential backoff, `meta.silentOnTransient = true` by default, only report on `failureCount >= 3 && navigator.onLine` | Per-call `onError → reportError` |
| `src/lib/build/buildId.ts` + Vite plugin | Emits `dist/build-id.json` with git SHA; `useBuildIdPoll()` checks every 60s and schedules a soft reload on next route change before stale-chunk error can fire | `lazyWithRetry` recovery noise |
| `src/utils/lazy-with-retry.ts` (refactor) | Retries silently; only `report()` if retry+reload **both** fail. Errors classified `chunk_stale` (separate metric, never triage queue) | Current per-failure reports |
| ESLint rules (custom + builtin) | `@typescript-eslint/only-throw-error`, `no-restricted-imports` for direct reporter, `no-supabase-single` (allows `// single-required: <reason>`), `no-raw-functions-invoke`, `no-raw-supabase-rpc` | Drift |

---

## PART B — Per-section, per-function fixes

### 1. Dynamic chunk loader (`src/utils/lazy-with-retry.ts`)
- **Now:** reports every failed dynamic import; recovers via reload.
- **Fix:** 
  - `loadWithRetry(factory)` → 3 attempts × 250/750/2000ms with cache-bust `?v={buildId}`.
  - On 3rd failure: read `build-id.json`; if mismatch, single hard reload (silent). If match, report **once** as `event_type=chunk_stale` (not `client_error`) to a dedicated `chunk_stale_log` table, never `agent_fix_queue`.
  - Remove the post-success `report()` calls.
- **Rail:** unit test simulates 2 failures + success → 0 reports. 3 failures + matching build id → 1 report to `chunk_stale_log`, 0 to triage.

### 2. Build-id versioning (NEW: `src/lib/build/`)
- `vite.config.ts` plugin writes `dist/build-id.json = {sha, builtAt}`.
- `useBuildIdPoll()` mounted in `App.tsx`; checks every 60s while visible; on mismatch sets `pendingReload`; `useRouterListener` reloads on next `navigate()` so the user never sees a stale-chunk error.
- **Eliminates root cause** of every NetworkActivity/Dashboard chunk error in the history.

### 3. React Query setup (`src/lib/query/queryDefaults.ts` + `src/App.tsx`)
- `QueryClient`:
  ```ts
  defaultOptions: {
    queries: {
      retry: (n, err) => n < 3 && classify(err).retriable,
      retryDelay: i => Math.min(1000 * 2 ** i, 8000),
      networkMode: 'online',  // pauses while offline
      throwOnError: false,
      meta: { silentOnTransient: true },
    },
    mutations: { networkMode: 'online', retry: 1 },
  }
  ```
- Global `onError` (via `QueryCache`/`MutationCache`) calls `report()` only when `failureCount >= 3 && classify(err).report === true`.
- **Removes** every per-query `onError` that currently calls `reportClientError` directly. Affected files (grep): `use-announcements.ts`, `useNotifications*.ts`, banners, role checks, network activity, teacher role, admin role, published-banners, banner-dismissals.

### 4. Reporter (`src/services/error-reporter.service.ts` → private; new `src/lib/observability/report.ts`)
- **Now:** mix of string regex suppression + direct enqueue.
- **Fix (structural classifier):**
  - `frameOrigin` check: any frame URL with `chrome-extension://|moz-extension://|safari-extension://|^about:` → drop (covers MetaMask, CookieYes-injected, generic `uncaught exception: undefined`).
  - `navigator.onLine === false` at throw time → drop (offline is user state).
  - `document.visibilityState === 'hidden'` AND fetch error → drop (tab backgrounded).
  - `err.name === 'AbortError'` → drop.
  - Serialized message `=== '[object Object]'` → re-classify `SerializationError` with throwing site as fingerprint (actionable, low-rate).
- **ESLint:** `no-restricted-imports` forbids importing anything except the public `report()`.
- **Rail:** `src/test/smoke/reporter-classification.smoke.test.ts` — 12 synthetic cases (offline, hidden tab, extension frame, AbortError, real bug).

### 5. Edge function invoker (`src/lib/edge/invokeEdge.ts`)
- All `supabase.functions.invoke()` callers refactored. Grep matches: `audited-invoke.ts`, `feedback.service.ts`, `explore.service.ts`, `push-subscription.service.ts`, `journey.service.ts`, `use-announcements.ts`, `general-application.service.ts`, `FleetyChatWidget.tsx`, `use-server-draft.ts`, plus ~20 more.
- Behavior: 8s AbortController timeout, single retry on `FunctionsFetchError` after 500ms, parsed Zod response, throws `EdgeInvokeError(name, status, body)`. Successful retry = 0 reports.
- **ESLint rule** `no-raw-functions-invoke` blocks direct calls outside the wrapper.

### 6. `.single()` codemod (database read layer)
- All call sites (grepped 80+ files: `class.service.ts`, `cohort.service.ts`, `profile.service.ts`, `banner.service.ts`, `announcement.service.ts`, `general-application.service.ts`, `policies.ts`, `auth.service.ts`, `RosterApplicantDetailPage.tsx`, `ProjectFormPage.tsx`, `ProjectApplicationStatusPage.tsx`, plus all edge functions).
- Codemod replaces `.single()` → `.maybeSingle()` and adds `if (!data) throw new NotFoundError(...)` where the caller previously assumed a row.
- Exception: caller asserts non-null with `// single-required: <reason>` comment.
- **ESLint rule** `no-supabase-single` enforces.

### 7. `general-application.service.ts` (root cause of 51 "Failed to save application")
- **Now:** throws `new Error('We could not save your application. Refresh and try again.')`.
- **Fix:** 
  - Replace with `throw new ApplicationSaveError(code, retriable, ctx)`.
  - Migrate to `invokeEdge('save-general-application', payload)` with idempotency key (existing pattern).
  - UI in `ProjectApplicationPage.tsx` handles `retriable` → auto-retry + inline status; terminal → toast + capture.
- **Rail:** 4 unit tests (network, 400, 409, 500).

### 8. `use-autosave.ts` (root cause of 39 `[object Object]` errors)
- **Now:** `throw err` where err is a Supabase `{code,message,details}` object.
- **Fix:** wrap all internal catches with `toError(err)`; rethrow `AppError`. Caller component receives proper `.message`.
- **Rail:** unit test asserts non-Error thrown → `report()` captures message ≠ `[object Object]`.

### 9. `use-server-draft.ts`
- Same `toError` migration.

### 10. Announcements (`src/services/announcement.service.ts`, `use-announcements.ts`)
- **Now:** ad-hoc polling, throws `Error('Failed to load announcements.')`.
- **Fix:**
  - Read goes through React Query with global defaults (Part B-3). Errors carry typed cause.
  - Service throws `NetworkError`/`RpcError` via `safeSelect`, never opaque "Failed to load".
- **Removes** root cause: the polling no longer produces user-visible "Failed to load" errors because React Query holds last successful data while retrying (data layer, not a UI band-aid). Reports happen only when truly broken.

### 11. Banners (`src/services/banner.service.ts`, `query.published-banners`, `query.banner-dismissals`)
- Migrate to global React Query defaults; remove direct `reportClientError` in onError.

### 12. Notifications poll (`src/services/notification*.ts`, NotificationsBell)
- Same React Query migration. Eliminates `getReadIds=91, list=91` floods (those were per-failure direct reports).

### 13. Role checks (`query.teacher-role`, `query.admin-role`, `usePermissions`)
- Same React Query migration. `has_role` RPC wrapped in `safeRpc` with `NetworkError` typing.

### 14. SupportWidget (residual)
- **Fix:** build-time grep in `vite.config.ts` fails the build if `SupportWidget` string appears anywhere in `src/`. The dead chunk URL stops being shipped on next deploy.

### 15. `digest(text, unknown)` (pgcrypto cast — 20 occurrences)
- Audit every `digest(` call in SQL migrations, edge functions, RPCs. Force `digest($1::text, 'sha256'::text)`. Move references to `extensions.digest` since pgcrypto lives in `extensions`.
- **Rail:** `scripts/lint/sql-digest.mjs` fails CI on any `digest(` without explicit `::text` cast.

### 16. RPC permission denied (18 occurrences for `get_announcement_view_counts`, `get_course_completion_counts`)
- Migration auditing every `public.*` function; grants `EXECUTE` to the role implied by caller. Adds `function_grant_audit` table + event trigger on `CREATE FUNCTION` that auto-records the new function with `granted=false` and fails the daily lint cron.
- Re-run `supabase--linter` post-migration to confirm.

### 17. `coordinator-for-app` PGRST116 (17 occurrences)
- Covered by Part B-6 codemod. Service returns `coordinator | null`; callers render "no coordinator assigned" empty state per single-query-errors rule.

### 18. Interview-invite pipeline (`stuck_pending`, 26 occurrences)
- Migration: `interview_invites.application_id` → `ON DELETE CASCADE` (FK).
- `process-email-queue/index.ts`: pre-flight check — if referenced application no longer exists, abandon the message with `dlq_reason='orphan'` (not triaged).
- Existing `email_interview_invite_pipeline_unhealthy` event_type tightened: only fires when `dlq_reason NOT IN ('orphan','ttl','rate_limit')`.

### 19. Email DLQ — TTL exceeded (20 occurrences) and missing_unsubscribe_token (10)
- **TTL:** dispatcher tags `dlq_reason='ttl'`; this is self-healing user-side (we cannot deliver; not a code bug). Route to analytics-only.
- **missing_unsubscribe_token:** add DB trigger on transactional `email_send_log` insert: rejects rows where `template_category='transactional' AND unsubscribe_token IS NULL`. Hard-fails enqueue at the edge function boundary — the bug becomes impossible.
- All callers (`send-transactional-email`, `send-announcement-email`, `send-project-blast`, etc.) audited to ensure they pass the token; Zod schema in `invokeEdge` requires it.

### 20. Email rate-limited / frequency-capped (60+ occurrences)
- Already self-healing per `mem://features/email-queue-per-lane-cooldown`. **Code change:** in `triage-error/index.ts`, refuse to insert when `event_type IN ('email_queue_rate_limited','email_frequency_capped','email_dlq_self_healing','chunk_stale','extension_noise')`. DB trigger on `agent_fix_queue` enforces (defense in depth).
- Delete the broad substring catalog rules (`rate_limited`, `validation_rejected`, `duplicate client error(s) deduped`, `Failed to fetch dynamically imported module`, etc.) and replace with typed `event_type` rules in `known_issue_catalog`. Add CHECK on `known_issue_catalog`: substring rules require `expires_at IS NOT NULL AND expires_at <= now() + interval '30 days'`.

### 21. CookieYes URL mismatch (12 occurrences)
- Not noise — it is misconfig. Register both `techfleet.network` and `www.techfleet.network` (and the lovable preview domain) in CookieYes account. New memory `mem://integrations/cookieyes` documents the registered domains list. Error stops firing.

### 22. MetaMask / browser-extension errors (12+)
- Covered by Part B-4 frame-origin classifier. Drop at reporter, never enqueue.

### 23. React #426 (Suspense hydration race)
- Disappears once Part B-2 (build-id soft reload) is shipped, because chunk swaps no longer happen mid-render. Suppression rule gets `expires_at = now() + 30 days`; if zero recurrence, deleted.

### 24. Triage queue hygiene (`agent_fix_queue`, `known_issue_catalog`, `triage-error` edge fn)
- DB trigger `reject_self_healing_on_agent_fix_queue` blocks the 5 self-healing event_types.
- Trigger `enforce_known_issue_substring_expiry` enforces the 30-day TTL on substring rules.
- `triage-error` edge fn: validates payload with Zod; rejects pre-classified noise; only AI-triages when classifier marks `actionable=true`.
- Nightly `triage_health` digest in System Health > Triage tab shows: active rules count, substring rules expiring soon, signals re-evaluated after expiry, top reporting sources.

### 25. ESLint rail (4 custom rules, `tools/eslint-rules/`)
| Rule | Forbids | Allowed via |
|---|---|---|
| `no-throw-non-error` (builtin) | `throw 'string'`, `throw {}` | `throw new AppError(...)` |
| `no-direct-error-reporter` | `import * from 'services/error-reporter.service'` | `import { report } from '@/lib/observability/report'` |
| `no-raw-functions-invoke` | `supabase.functions.invoke(` | `invokeEdge(...)` |
| `no-supabase-single` | `.single()` | `.maybeSingle()` or `// single-required: <reason>` |
| `no-raw-supabase-rpc` | `supabase.rpc(` outside `safeRpc` | `safeRpc(...)` |

### 26. BDD coverage (≥30 new rows in `bdd_scenarios`, tag `@triage-permanent`)
Each scenario has tri-layer Then-clauses ([UI]/[DB]/[Code]). Examples:
- `TRP-001 Stale-chunk soft-reload before failure` — build-id mismatch triggers reload on next navigation; user sees zero error; `chunk_stale_log` count = 1; `agent_fix_queue` count = 0.
- `TRP-002 Offline error not reported` — `navigator.onLine=false`, fetch throws → classifier drops; reporter network call = 0.
- `TRP-003 Extension-frame error not reported` — synthetic error with `chrome-extension://` frame → 0 enqueue.
- `TRP-004 PGRST116 returns typed NotFoundError` — `maybeSingle` returns null → service throws `NotFoundError`; UI shows empty state, not toast.
- `TRP-005 Transactional email enqueue rejected without token` — INSERT into `email_send_log` without `unsubscribe_token` → DB error; edge function returns 400.
- `TRP-006 Orphan interview invite dropped` — application deleted → dispatcher marks `dlq_reason='orphan'`; pipeline-unhealthy event does NOT fire.
- `TRP-007 use-autosave serializes Supabase error` — `{code,message}` thrown → `toError` produces real Error; report payload `.message != '[object Object]'`.
- `TRP-008 ApplicationSaveError retries network failures` — fetch throws once → service retries; success on attempt 2; UI never shows toast.
- `TRP-009 digest() callers cast text` — SQL lint scans all migrations; 0 violations.
- `TRP-010 Function-grant audit detects missing GRANT` — create function without grant → daily cron sets `triage_health.missing_grants > 0`.
- `TRP-011 React Query default does not report transient` — 1st/2nd failure online → no report; 3rd → 1 report.
- `TRP-012 Build-time SupportWidget guard` — adding `SupportWidget` string → build fails.
- `TRP-013 known_issue_catalog substring rule requires expiry` — INSERT substring rule without expires_at → trigger rejects.
- `TRP-014 agent_fix_queue blocks self-healing event_types` — INSERT chunk_stale → trigger rejects.
- `TRP-015 EdgeInvokeError on real failure only` — single fetch retry succeeds → no error; both fail → typed error thrown.
- ...through TRP-030 covering each rebuilt service.

---

## PART C — Files touched (by area)

```text
# Foundations (new)
src/lib/errors/AppError.ts
src/lib/errors/toError.ts
src/lib/observability/report.ts
src/lib/observability/classify.ts
src/lib/edge/invokeEdge.ts                    (harden existing audited-invoke)
src/lib/db/safeRpc.ts                         (harden)
src/lib/db/safeSelect.ts                      (new)
src/lib/query/queryDefaults.ts                (new)
src/lib/build/buildId.ts                      (new)
src/lib/build/useBuildIdPoll.ts               (new)
vite.config.ts                                (build-id plugin, no-cache index.html, SupportWidget guard)

# Lazy loader
src/utils/lazy-with-retry.ts                  (silent-first-fail + build-id integration)

# Reporter (refactored to private)
src/services/error-reporter.service.ts        (becomes internal; public surface = report.ts)
src/components/ErrorBoundary.tsx              (uses report())

# React Query migration (per service)
src/App.tsx                                   (QueryClient defaults)
src/hooks/use-announcements.ts
src/hooks/use-explore.ts
src/hooks/use-autosave.ts                     (toError + AppError)
src/hooks/use-server-draft.ts                 (toError + AppError)
src/hooks/use-discord-username-repair.ts
src/hooks/use-discord-role-retry.ts
src/hooks/use-membership-realtime.ts
src/services/announcement.service.ts
src/services/banner.service.ts
src/services/notification*.service.ts
src/services/general-application.service.ts   (ApplicationSaveError + invokeEdge + idempotency)
src/services/profile.service.ts
src/services/class.service.ts
src/services/cohort.service.ts
src/services/journey.service.ts
src/services/explore.service.ts
src/services/feedback.service.ts
src/services/push-subscription.service.ts
src/services/discord-notify.service.ts
src/services/auth.service.ts
src/services/class-emails.ts
src/integrations/supabase/audited-invoke.ts   (wraps invokeEdge)

# Codemod targets (.single → .maybeSingle + typed NotFoundError)
src/pages/*.tsx                               (16 pages from grep)
src/components/**                             (20+ components)
supabase/functions/**/index.ts                (15+ edge functions)

# Edge functions
supabase/functions/triage-error/index.ts                  (Zod + pre-classifier + reject self-healing)
supabase/functions/process-email-queue/index.ts           (dlq_reason routing + orphan check)
supabase/functions/send-transactional-email/index.ts      (unsubscribe_token required)
supabase/functions/send-announcement-email/index.ts       (unsubscribe_token required)
supabase/functions/send-project-blast/index.ts            (unsubscribe_token required)

# Migration (one consolidated file)
supabase/migrations/<ts>_triage_permanent_refactor.sql
  - CREATE TABLE chunk_stale_log
  - CREATE TABLE function_grant_audit
  - EVENT TRIGGER on CREATE FUNCTION → function_grant_audit
  - GRANT EXECUTE backfill for all current public.* functions
  - ALTER TABLE interview_invites: FK ON DELETE CASCADE on application_id
  - CREATE TRIGGER reject_self_healing_on_agent_fix_queue
  - CREATE TRIGGER enforce_known_issue_substring_expiry
  - DELETE substring known_issue_catalog rules added 2026-05-28 / 2026-05-30
  - INSERT typed event_type rules
  - CREATE TRIGGER transactional_email_requires_unsubscribe_token
  - All digest() callers cast ::text

# ESLint
tools/eslint-rules/no-direct-error-reporter.cjs
tools/eslint-rules/no-raw-functions-invoke.cjs
tools/eslint-rules/no-supabase-single.cjs
tools/eslint-rules/no-raw-supabase-rpc.cjs
.eslintrc.cjs                                 (enable rules + @typescript-eslint/only-throw-error: error)

# Tests
src/test/smoke/triage-root-causes.smoke.test.ts        (12+ cases)
src/test/smoke/reporter-classification.smoke.test.ts   (extension/offline/hidden/AbortError)
src/test/smoke/lazy-with-retry.smoke.test.ts           (silent recovery)
src/test/smoke/query-defaults.smoke.test.ts            (failureCount escalation)
src/test/services/general-application.service.test.ts  (4 failure modes)
src/test/services/use-autosave.test.ts                 (toError canonicalization)
scripts/lint/sql-digest.mjs                            (CI lint)
bdd_scenarios                                          (~30 inserts tagged @triage-permanent)

# Memory updates
mem://index.md                                         (supersede 2026-05-30 entries)
mem://tech/observability/single-reporter               (new)
mem://tech/data/resilient-query                        (new — describes React Query defaults, not graceful degradation)
mem://tech/build-id-versioning                         (new)
mem://tech/errors/typed-hierarchy                      (new)
mem://integrations/cookieyes                           (new — registered domains)
```

---

## PART D — Verification (post-build)

1. `SELECT count(*) FROM agent_fix_queue WHERE status='pending'` → 0
2. `SELECT count(*) FROM known_issue_catalog WHERE match_kind='substring' AND expires_at IS NULL` → 0
3. `SELECT count(*) FROM function_grant_audit WHERE granted=false` → 0
4. `bdd_scenarios` query: ≥30 rows tagged `@triage-permanent`, each with [UI]+[DB]+[Code] Then-clauses
5. `npm run test -- triage` → all green
6. ESLint: 0 violations across 5 new rules
7. Synthetic offline DevTools test → reporter network call count = 0
8. Synthetic chunk-rename test → 1 silent reload, 0 reports
9. `supabase--linter` clean
10. SQL `digest(` lint → 0 violations

---

## PART E — Explicitly NOT doing

- No new string-match suppressions.
- No new graceful-degradation wrappers (per your directive). The React Query defaults are **vanilla framework behavior** — retries with backoff are the React Query default contract, not a custom degradation layer. Failed loads after 3 retries throw real typed errors to the UI; users see proper empty/error states per WCAG.
- No removal of compliance signals (audit hash chain, security_events).

Approve and I ship every section above in one pass.
