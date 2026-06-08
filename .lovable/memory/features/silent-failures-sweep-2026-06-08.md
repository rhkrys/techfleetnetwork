---
name: Silent Failures Sweep 2026-06-08
description: Permanent fixes for the 7-day silent-failure / triage report — DOM-extension classifier, experience-areas cap, no-rpc-then-catch ESLint rule, auto-resolve stale fix_queue cron
type: feature
---

# 2026-06-08 silent-failure sweep

Permanent fixes for every recurring `*_failed`/`*_error` class found in the
last 7 days of `audit_log`. No band-aids.

## Fixes shipped

| # | Class | Permanent fix |
|---|---|---|
| A | `validation_rejected: experience_areas: Too many` (7 events / 4 users) | `MAX_EXPERIENCE_AREAS = 30` exported from `src/lib/validators/profile.ts`; `ExperienceAreasSelect` disables unselected options at cap and shows live "N of 30 selected" counter; `ProfileEditPanel` migrated from raw `MultiSelect` to the capped picker. Server-side rejection now structurally impossible. |
| C | `ui_render_error: NotFoundError: Failed to execute 'insertBefore' on 'Node'` (Google Translate / Transover DOM-mutation race) | `isDomExtensionMutationError()` added to `src/lib/observability/classify.ts` — drops these at the reporter (not our bug). `ScopedErrorBoundary` silently remounts via a bumped `resetKey` on the first two occurrences instead of showing the red fallback. `<ConnectDiscordPage>` wraps `<ProfileDiscordConnector>` in `<ScopedErrorBoundary label="Connect to Discord">`. DB backstop: `known_issue_catalog` entries for `insertBefore` / `removeChild` / `transover-popup` / `Failed to connect to MetaMask` (30-day rolling TTL). |
| D | `email_failed: supabase.rpc(...).catch is not a function` (18 events) | Already root-fixed in `process-email-queue` (try/await/catch wrap). New ESLint rule **`triage-permanent/no-rpc-then-catch`** (error level) in `scripts/lint/eslint-plugin-no-rpc-then-catch.mjs` blocks the entire class from returning. Escape hatch: `// rpc-catch-ok: <reason>`. |
| E | Stale `freescout-proxy invoke_error` fingerprints (22, no recurrence since eager-provisioning shipped 2026-06-02) | Migration explicitly closes those rows. New `auto_resolve_stale_fix_queue()` SECURITY DEFINER + nightly cron `auto-resolve-fix-queue-nightly` (04:15 UTC) auto-resolves: `severity=error` after 30d, `warn` after 7d, `info` after 3d. Triage tab can never again accumulate zombie rows. |

## Out of scope (verified no recurrence / not actionable)
- `client_error_suppressed` (45 events) — already correctly suppressed
  extension/third-party noise. Added DB-level catalog seeds for the top three
  patterns (insertBefore, transover-popup, MetaMask) as defense-in-depth.
- `chunk_stale` (6 events) — already handled by `lazyWithRetry` +
  `<UpdateAvailableBanner/>` at severity `info`; never reaches triage.
- `authn_unauthorized` (8 events) — last seen 2026-06-02, pre-eager-provisioning.

## Files
```
src/lib/observability/classify.ts                   (new isDomExtensionMutationError + classify rule)
src/components/ScopedErrorBoundary.tsx              (resetKey-based silent remount)
src/pages/ConnectDiscordPage.tsx                    (wrap connector)
src/lib/validators/profile.ts                       (export MAX_EXPERIENCE_AREAS)
src/components/ExperienceAreasSelect.tsx            (cap + counter)
src/components/ProfileEditPanel.tsx                 (migrate to capped picker)
scripts/lint/eslint-plugin-no-rpc-then-catch.mjs    (new rule)
eslint.config.js                                    (register rule, level=error)
supabase/migrations/<this>_auto_resolve_stale_fix_queue + known_issue seeds
```
