## What's actually open in `agent_fix_queue`

After collapsing duplicates, the queue has **two distinct root causes** (everything else is stale residue of fixes that already shipped):

| # | Fingerprints | Last seen | Root cause | Status |
|---|---|---|---|---|
| 1 | `client_error::query.dashboard-overview.*::…get_dashboard_overview(p_user_id) not in schema cache` (3 rows, incl. one `frontend` SHA) | 2026-06-11 04:27 | Old build called the 1-arg RPC; the 0-arg refactor (migration `20260611042504`) already shipped and `pg_proc` now has exactly one row with `pronargs=0`. | **Stale — auto-close** |
| 2 | `client_error::query.dashboard-overview.*::Unauthorized` (2 rows) | 2026-06-10 22:44 | Same pre-deploy build — JWT race during the cache-identity-guard rollout. Cache-purge fix shipped in `ProgressCacheIdentityGuard` + `JOURNEY-IDENTITY-001..004`. | **Stale — auto-close** |
| 3 | `ui_render_error::ErrorBoundary:/applications/general::NotFoundError: Failed to execute 'removeChild' on 'Node'` (component stack points at `AutosaveStatus`) | 2026-06-11 15:59 | **Live bug.** Runtime DOM translator (`src/lib/i18n/dom-translator.ts`) mutates text nodes inside React-managed `aria-live` regions. When `useAutosave` flips `status` ("Saving…" → "Saved · just now"), React's reconciler calls `removeChild` on a Text node the translator already swapped, throwing `NotFoundError`. | **Real — root-cause fix** |

## Permanent fixes

### Fix A — DOM translator vs. React reconciliation race (root cause for #3)

Three reinforcing layers; none individually trusted, all three required:

1. **Translator: never touch React's volatile regions.** Extend `shouldSkipElement` in `src/lib/i18n/dom-translator.ts` to also return `true` when the element (or any ancestor) has:
   - `aria-live` attribute set to `polite` or `assertive` (covers AutosaveStatus, LiveAnnouncer, toasts, status pills)
   - `role="status" | "alert" | "log" | "timer"`
   - the existing `n` boolean attribute (currently *documented* as honored but not actually checked — bug; align with the memory rule)
   - `data-translate="manual"` (escape hatch for future React-volatile widgets)

2. **AutosaveStatus hardening.** Add `data-no-translate` + `translate="no"` to the wrapper `<span>` in `src/components/ui/AutosaveStatus.tsx`. Belt + suspenders so a translator regression can't re-introduce the race.

3. **Standardize the opt-out attribute.** Replace stray `n` boolean attributes in JSX (`AnnouncementBanner`, `AppLayout`, `LiveAnnouncer`, `UpdatesPage`) with `data-no-translate` — the canonical name from `mem://`. The translator skips both for back-compat, but new code only uses `data-no-translate`. ESLint rule + CI guard added below.

### Fix B — Stale `agent_fix_queue` rows (root cause for #1 and #2)

One migration that:
- Auto-resolves the 5 stale rows by fingerprint match (status → `resolved`, `dismissed_reason = 'superseded_by_deploy'`, `resolved_at = now()`).
- Adds a generic helper `resolve_stale_fingerprints_on_deploy(p_fingerprint_like text, p_reason text)` so future deploys can declaratively close their own residue instead of relying on the daily digest.

### Fix C — Guardrails so this class of bug cannot return

1. **CI script `scripts/ci/check-translator-volatile-regions.mjs`** — fails the build if any new JSX adds `aria-live`, `role="status|alert|log"` without also carrying `data-no-translate` OR being inside the translator's known-safe wrappers.
2. **Vitest** `src/lib/i18n/__tests__/dom-translator.volatile-regions.test.ts` — mounts a fixture with an `aria-live` span, switches language, asserts the translator leaves the node alone and React can unmount it without throwing.
3. **Vitest** `src/components/ui/__tests__/AutosaveStatus.translator-race.test.tsx` — drives `idle → saving → saved → error` while a stub MutationObserver runs concurrently; asserts no `removeChild` throw.
4. **BDD scenarios** persisted in `bdd_scenarios` (required by workspace rule):
   - `TRANSLATOR-VOLATILE-001` — Given non-English locale and an `aria-live` region, When React re-renders the region, Then [UI] no error boundary trips, [DB] no `agent_fix_queue` insert with `ui_render_error::removeChild`, [Code] `shouldSkipElement` returns `true` for the region.
   - `TRANSLATOR-VOLATILE-002` — Given an `<AutosaveStatus>` cycling states, When language ≠ en, Then [UI] pill updates without flicker, [DB] no triage row, [Code] translator never enqueues the pill's text.
   - `TRANSLATOR-VOLATILE-003` — Given legacy `n` boolean attribute, When translator walks, Then [Code] node is skipped (back-compat) and ESLint warns on new occurrences.
   - `DASHBOARD-RPC-RESIDUE-001` — Given stale fingerprints for the 1-arg RPC, When the resolve-stale-fingerprints migration runs, Then [DB] those rows become `status=resolved` with `dismissed_reason='superseded_by_deploy'` and [UI] System Health Triage tab no longer shows them.

### Fix D — Memory + runbook

Append a new memory file `mem://constraints/translator-volatile-regions` capturing: aria-live / role=status / `data-no-translate` is the canonical skip contract; back-compat for `n` attr is honor-only, ESLint discourages new uses.

## Files touched

```text
src/lib/i18n/dom-translator.ts                       # extend shouldSkipElement
src/components/ui/AutosaveStatus.tsx                 # data-no-translate + translate="no"
src/components/AnnouncementBanner.tsx                # n → data-no-translate
src/components/AppLayout.tsx                         #   "
src/components/LiveAnnouncer.tsx                     #   "
src/pages/UpdatesPage.tsx                            #   "
src/lib/i18n/__tests__/dom-translator.volatile-regions.test.ts            # new
src/components/ui/__tests__/AutosaveStatus.translator-race.test.tsx       # new
scripts/ci/check-translator-volatile-regions.mjs                          # new
.github/workflows/regression.yml                                          # wire new CI step
supabase/migrations/<ts>_resolve_stale_dashboard_overview_fingerprints.sql # Fix B + BDD rows
.lovable/plan.md                                                          # status update
```

## Verification receipts (what I'll show after build)

1. `SELECT status, count(*) FROM agent_fix_queue WHERE status NOT IN ('resolved','dismissed','wont_fix') GROUP BY 1;` → expect 0 rows (or only post-deploy rows).
2. `bunx vitest run src/lib/i18n/__tests__/dom-translator.volatile-regions src/components/ui/__tests__/AutosaveStatus.translator-race` → 2 suites green.
3. `node scripts/ci/check-translator-volatile-regions.mjs` → exit 0.
4. `SELECT count(*) FROM bdd_scenarios WHERE scenario_id IN ('TRANSLATOR-VOLATILE-001','TRANSLATOR-VOLATILE-002','TRANSLATOR-VOLATILE-003','DASHBOARD-RPC-RESIDUE-001');` → 4.
5. No live RPC errors in dev-server / edge-function logs after refresh.

## Out of scope (deliberately)

- No changes to `auth`, `profiles`, `journey_progress`, `course_completions`, `badges_awarded`, MFA, RLS, rate-limit, or audit tables.
- No changes to `get_dashboard_overview` (already correct).
- No new auth entrypoints (workspace rule: one auth engine, already honored).
