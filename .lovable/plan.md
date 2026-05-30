# Refactor — permanently fix the triages instead of suppressing them

The previous turn closed the triage queue by adding substring suppressions to `known_issue_catalog` + reporter regexes. That hid symptoms. This plan removes every suppression added on 2026-05-30 and refactors each source so the error never fires in the first place (or fires with the right severity/event_type that routes around triage by design). New BDD scenarios are added to the regression suite so future regressions fail CI.

## What we suppressed → what we'll do instead

| # | Suppression added | Root cause | Permanent refactor |
|---|---|---|---|
| 1 | `Not authorized for project` + `code=42501` | `get_project_internal_links` RPC `RAISE EXCEPTION ... 42501` when caller isn't on roster | Change RPC: **return 0 rows** for non-authorized callers instead of raising. Drop the client-side 42501 swallow in `MyProjectsTab.tsx`. UI already handles `links === null`. |
| 2 | `Push notifications are not ready` | String only appears in a user-facing `SubscribeResult.message`. Was reaching audit because callers wrapped the returned message into a thrown `Error`. | Add invariant: callers must branch on `SubscribeResult.status` and never throw `.message`. Inline guard + test. |
| 3 | `service worker is unavailable` | Same `getSubscriptionFailureMessage` branch as #2. | Same refactor as #2. |
| 4 | `Recipient already received` | `process-email-queue` writes literal into `email_send_log.error_message` on frequency cap. | Cap path already `continue`s without throwing. Emit `reportActivity('email_capped', severity:'info')` and add `email_capped` to `NON_ACTIONABLE_EVENT_TYPES` (TS) + `v_non_actionable` (PL/pgSQL trigger) + `v_excluded_events` (discover_audit_fingerprints). |
| 5 | `TTL exceeded` | `moveToDlq` from `process-email-queue` on expiry. | Refactor `moveToDlq` to take an `event_type` arg; TTL path passes `email_dlq`; real send-failure keeps `edge_invoke_failed`. With `email_dlq` non-actionable, expiries never reach triage. |
| 6 | `use-autosave` | Legacy bundles emitted `"[object Object]"`. Fixed by `normalizeThrownError`. | No code change — remove catalog row. Stale tabs heal on reload. |
| 7 | `Script error.` | Cross-origin script with no CORS attribute. | Add `crossorigin="anonymous"` to script tags in `index.html`; `Access-Control-Allow-Origin` already in `public/_headers`. Reporter keeps structural guard (`event.error===null && !filename && lineno===0`); drop the catalog row. |
| 8 | (none new) `Failed to count progress` | Already throws structured error with `code`/`status`. | Verify `src/lib/react-query.ts` QueryCache.onError calls `isTransientError` and skips reporting; wire if missing. |

## Files to edit

**Backend / DB (one migration)**
- `CREATE OR REPLACE FUNCTION public.get_project_internal_links` — drop `RAISE EXCEPTION '... 42501'`; replace with `IF NOT authorized THEN RETURN; END IF;` (returns empty rowset).
- Update `block_non_actionable_fix_queue_inserts` trigger: append `'email_capped'`, `'email_dlq'` to `v_non_actionable`.
- Update `discover_audit_fingerprints`: append same two event_types to `v_excluded_events`.
- `DELETE FROM known_issue_catalog WHERE pattern IN ('Not authorized for project','code=42501','Recipient already received','TTL exceeded','Push notifications are not ready','service worker is unavailable','use-autosave','Script error.')`.
- Seed new BDD scenarios into `bdd_scenarios` (see BDD section).

**Edge functions**
- `supabase/functions/process-email-queue/index.ts` — `moveToDlq(supabase, queue, msg, reason, eventType='edge_invoke_failed')`; TTL branch passes `'email_dlq'`. On frequency cap: insert `audit_log` row via `write_audit_log` with `p_event_type='email_capped'` severity info.

**Frontend**
- `src/services/error-reporter.service.ts` — add `'email_capped'`, `'email_dlq'` to `NON_ACTIONABLE_EVENT_TYPES` and `ReportEventType`. Remove the 8 substring entries added today; keep structural classifiers (chunk-load, opaque `Script error.`, AbortError DOMException).
- `src/components/MyProjectsTab.tsx` — remove `if (error.code === '42501') return null` branch.
- `src/services/push-subscription.service.ts` — inline comment + guard that `SubscribeResult.message` is never thrown.

**Memory**
- Update `mem://features/triage-noise-suppression.md` — add `email_capped` + `email_dlq` to canonical list.

## BDD scenarios → regression suite

All seven scenarios go into `bdd_scenarios` (feature_area_number 1114 — Error Triage Queue) with tri-layer Then-clauses ([UI]/[DB]/[Code]) per `mem://constraints/bdd-expected-results`. Each links to a real Vitest spec under `src/test/smoke/triage-permanent-fixes.smoke.test.ts` so `scripts/bdd-coverage.ts` keeps the ratchet at 0 unlinked. Specs run inside the `quality` job of `.github/workflows/regression.yml` via `npm run test`, gating every PR.

| ID | Title | Assertion |
|---|---|---|
| TRIAGE-FIX-001 | Roster-gated internal links return empty rows, never 42501 | DB call to `get_project_internal_links` as non-roster returns 0 rows with no exception; `agent_fix_queue` unchanged. |
| TRIAGE-FIX-002 | Push subscribe never throws user-facing copy | Static check: no `throw new Error(getSubscriptionFailureMessage(...))` anywhere; runtime test: subscribe on env without SW returns `{status:'unsupported'}`. |
| TRIAGE-FIX-003 | Frequency-capped emails emit `email_capped`, not `client_error` | After cap fires, `audit_log` has `event_type='email_capped'` severity `info`; `agent_fix_queue` row count unchanged. |
| TRIAGE-FIX-004 | DLQ TTL expiry emits `email_dlq`, not `client_error` | Synthetic TTL expiry → `audit_log` row with `event_type='email_dlq'`; trigger blocks any direct `agent_fix_queue` insert with that event_type. |
| TRIAGE-FIX-005 | `Script error.` opaque events stay out of triage | Simulated `ErrorEvent` with empty filename/lineno is classified, dropped before `writeAudit`. |
| TRIAGE-FIX-006 | `known_issue_catalog` carries zero suppressions for refactored sources | DB query asserts no rows match the 8 removed patterns. |
| TRIAGE-FIX-007 | React Query transient errors don't reach `reportError` | `QueryCache.onError` short-circuits when `isTransientError(err)` is true. |

Spec file: `src/test/smoke/triage-permanent-fixes.smoke.test.ts` (Vitest). Plus one Playwright check added to `e2e/smoke/critical-paths.e2e.ts` asserting non-roster project-detail load produces no console errors.

CI wiring (no workflow edits needed):
- `quality` job already runs `npm run test` → Vitest picks up the new smoke spec automatically (`src/**/*.{test,spec}.{ts,tsx}` glob in `vitest.config.ts`).
- `playwright` job (3-shard Chromium gate) already runs all of `e2e/` → picks up the new critical-path assertion.
- `quality` job already runs `npx tsx scripts/bdd-coverage.ts` → the seeded scenarios link to the new spec file, keeping `IMPLEMENTED_UNLINKED_MAX = 0`.

## Verification (run after build mode)

1. Non-roster user opens roster-gated project → no console error, no audit row.
2. Trip cap in dev → `email_send_log.status='frequency_capped'` + `audit_log.event_type='email_capped'`, no `agent_fix_queue` row.
3. Force TTL on queued bulk email → DLQ row with `event_type='email_dlq'`, no triage row.
4. `SELECT count(*) FROM agent_fix_queue WHERE status='pending'` → 0.
5. `SELECT count(*) FROM known_issue_catalog WHERE created_at > '2026-05-30'` → 0.
6. `npm run test -- triage-permanent-fixes` → all 7 scenarios pass.
7. BDD coverage ratchet green.

## Out of scope
Pre-existing structural patterns (AbortError, FunctionsFetchError, ResizeObserver, browser-extension noise) stay — they are correctly classified per `mem://constraints/firefox-stale-chunk-loop` and `mem://tech/graceful-degradation`.
