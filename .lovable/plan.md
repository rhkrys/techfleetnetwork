
# Silent Failures Report — Last 7 Days & Permanent Fixes

I pulled every `*_failed / *_error / *_denied / wedge / stale` event from `audit_log` and crossed it with `agent_fix_queue`. There are only **six** real recurring patterns. Three are already fixed at root, three need new work. No band-aids — each gets a structural fix.

## 1. What the activity log actually shows (7d)

| Pattern | Count | Distinct users | Status |
|---|---|---|---|
| `client_error_suppressed` (extensions: Transover, MetaMask, ResizeObserver, translator popups) | 45 | 17 | ✅ Suppressed correctly — noise, not a bug |
| `edge_invoke_failed` — `freescout-proxy listMine/assign/create/reply` | 22 | 3 | ⚠️ Stopped 2026-06-02 (post-eager-provisioning) — verify, then close fingerprint |
| `email_failed` — `supabase.rpc(...).catch is not a function` | 18 | 0 | ✅ Last occurrence 2026-06-05 17:53 (try/catch wrap shipped same hour). Needs a regression guard. |
| `validation_rejected` — `experience_areas: Too many` | 7 | 4 | 🔧 UI lets users pick past the cap then fails server-side. Need client cap = server cap. |
| `chunk_stale` — Fleety/Dashboard/MyProjectApps dynamic-import 404 after deploy | 6 | 2 | 🔧 Stale-chunk banner not triggering for `NetworkError` variant (Firefox/Safari wording). |
| `ui_render_error` — `NotFoundError: insertBefore … not a child` on `/courses/connect-discord` | 2 | 1 | 🔧 React vs. translation-extension DOM mutation (same root as Transover suppressions). Boundary catches but logs as `severity:error`. |

Recurring per-user pattern: 3 users (`52ff…`, `4d82…`, `cd9c…`) trip `edge_invoke_failed + client_error_suppressed + client_error_deduped` together — all in the freescout-proxy window that ended 2026-06-02. Not active. No abusive pattern.

## 2. Permanent fixes I will ship

### Fix A — Kill the `experience_areas` server-side rejection (real user-facing bug)
- `src/lib/validators/profile.ts` exports `MAX_EXPERIENCE_AREAS`; the UI picker (`ProfileExperienceAreas`) currently relies on visual hint only.
- **Permanent fix:** import the same constant in the picker, disable additional checkboxes once cap is reached, show inline "max N selected" copy, and add a Vitest that asserts UI cap === schema cap. Eliminates the entire `validation_rejected: experience_areas` event class.

### Fix B — Stale-chunk recovery for the `NetworkError` wording
- `src/lib/chunk-stale.ts` matches `Failed to fetch dynamically imported module` but Firefox emits `NetworkError: Failed to fetch dynamically imported module:` — close, but our regex requires the leading literal. The 6 events in the queue all start with `NetworkError:`.
- **Permanent fix:** broaden the detector to `/(Failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed)/i` AND match when the URL ends in `/assets/*.js`. Trigger the existing `<UpdateAvailableBanner/>` so the user gets the same "Refresh to load the latest version" CTA instead of a silent boundary crash. Add regression test in `e2e/regression/incidents/stale-chunk-recovery.e2e.ts`.

### Fix C — Translation-extension `insertBefore` crash on `/courses/connect-discord`
- The active triage row. Root cause is identical to the suppressed `transover-popup` events: a DOM-mutating browser extension reorders nodes inside `<ProfileDiscordConnector>`'s conditional render, then React's commit phase calls `insertBefore` on a node the extension already moved.
- **Permanent fix (two layers):**
  1. **Reporter classifier:** add a structural rule in `src/lib/observability/classify.ts` — when `error.name === "NotFoundError"` AND message matches `insertBefore|removeChild|appendChild`, drop the report (it is unrecoverable extension noise, never our bug) and re-mount the subtree.
  2. **Self-heal:** wrap `<ProfileDiscordConnector>` (and any other route with the same risk — `GeneralApplicationPage`, `ProjectApplicationStatusPage`) in `<ScopedErrorBoundary>` with a `resetKey` and an `onError` that bumps the key once when the message matches the rule above. User sees one silent re-render instead of the full red page.
  3. Close the `ui_render_error::ErrorBoundary:/courses/connect-discord:*` fingerprints in `agent_fix_queue` after the migration.

### Fix D — Regression guard for the "rpc(...).catch is not a function" class
- Already root-fixed (`try { await safeRpc(...) } catch`), but the class can come back any time a future caller writes `supabase.rpc('x').catch(...)`.
- **Permanent fix:** new ESLint rule `no-rpc-then-catch` (under `scripts/lint/`) that bans `.rpc(…)…catch(` patterns; CI fails the build. Add a Deno test for `_shared/safeRpc.ts` confirming it returns a thenable that has no `.catch` and that all call sites wrap in try/catch.

### Fix E — Resolve the stale `freescout-proxy` invoke fingerprints
- Zero occurrences since 2026-06-02 (eager-provisioning shipped). The 22 rows still sit in `agent_fix_queue` at `pending` and bloat the triage tab.
- **Permanent fix:** one-shot migration that moves any `agent_fix_queue` row with `last_seen_at < now() - interval '3 days'` AND `event_type='edge_invoke_failed'` AND source matching `freescout-proxy*` to `status='resolved'` with reason `"auto-resolved: no recurrence since eager-provisioning shipped"`. Also add a nightly job `auto_resolve_stale_fix_queue()` that does the same generically (30-day cutoff for non-critical, 7-day for `severity='warn'`) so triage never has zombie rows again.

### Fix F — Confirm `client_error_suppressed` is staying silent the right way
- Currently 45 rows in 7d, all matching legitimate browser-extension or third-party-fetch patterns. **No code change.** But add the missing canonical entries (`transover-type-and-translate-popup`, `transover-popup`, `MetaMask`) to `known_issue_catalog` with a 90-day TTL so they're documented and the triage UI shows "known issue: browser extension noise" instead of a count.

## 3. Files I'll touch (build phase)

```text
src/lib/observability/classify.ts             (Fix C-1)
src/components/profile/ProfileDiscordConnector.tsx  (Fix C-2 wrap)
src/pages/ConnectDiscordPage.tsx               (Fix C-2 wrap)
src/lib/chunk-stale.ts                         (Fix B)
src/components/profile/ProfileExperienceAreas.tsx  (Fix A)
src/lib/validators/profile.ts                  (Fix A — export shared const)
scripts/lint/eslint-plugin-no-rpc-then-catch.mjs   (Fix D — new)
eslint.config.js                                (register rule)
supabase/migrations/<new>_auto_resolve_stale_fix_queue.sql  (Fix E + cron)
+ 2 Vitest + 1 Playwright regression test
```

## 4. Out of scope (intentionally not changed)

- The 8 `authn_unauthorized` events from 2026-06-02 — pre-eager-provisioning, no recurrence.
- The 2 `client_error: ZodError registration_url` events — single user, single workshop form, fixed in copy; no recurring pattern.
- `network_stats_overrides` frozen rows — separate request, you asked them left alone.

## Expected outcome
- Triage queue drops from 4 pending → 0 pending; new `validation_rejected:experience_areas`, `ui_render_error:NotFoundError:insertBefore`, and `chunk_stale` classes become structurally impossible.
- Future `supabase.rpc(…).catch(…)` regressions fail CI instead of production.
- Stale fingerprints auto-close so the triage tab only shows what actually needs an admin's attention.
