## Activity-log audit (May 1 – Jun 4, 2026) — honest delta

### What I previously proposed is ALREADY shipped

Cross-checked against memory + codebase + DB. All of the following are live and need no work:

| Item | Where it lives |
|---|---|
| `lazyWithRetry` + ESLint rule + UpdateBanner + multi-layer stale-chunk guard | `src/lib/lazyWithRetry.ts`, `scripts/lint/eslint-plugin-lazy-requires-retry.mjs`, [Stale chunk prevention] |
| Chunk-load → `severity:warn`, blocked from Triage at 8 layers | [Triage Noise Suppression] |
| Duplicate generic audit triggers dropped on profiles / general_applications / project_applications / projects | Verified via `pg_trigger` — only targeted `audit_table_change_filtered` + lifecycle triggers remain. [Audit Sink Tri-Partite] |
| Audit sink CI guard | `scripts/ci/check-audit-sink-coverage.mjs` |
| Workspace email token bucket consumed inside fan-out | [Email Workspace Token Bucket] |
| Bulk vs auth/transactional lane isolation + per-lane cooldown | [Email Queue Per-Lane Cooldown] |
| `freescout-proxy invoke_error` → `severity:warn` + retry contract | [Edge CORS Trace Header], [Get Help Scale Contract] |
| ZodError unhandled-rejection classifier | last turn |
| Benign email lifecycle events (`reconciled`/`rate_limited`/`frequency_capped`/`suppressed`) reclassified to `severity:info` | last turn |
| `metric_key` ambiguous + DB-wide `#variable_conflict use_column` backfill + CI guard | last turn |
| No-auto-reload on deploy | [No Auto-Reload On Deploy] |

The `profile_updated` (2,617) vs `profiles_update` (927) counts I flagged are NOT duplicates — `profile_updated` is a `record_event` call from `profile.service.ts`, `profiles_update` is the targeted privileged-column trigger. Different events on different rows. Withdrawing that finding.

### What stopped occurring after the May refactor (no action needed)

Latest occurrence dates from the CSV confirm these were already fixed by later migrations:

| Issue | Last seen | Status |
|---|---|---|
| `permission denied for get_announcement_view_counts` / `get_course_completion_counts` / `get_community_events_health` | May 13–14 | GRANTed — verified `has_function_privilege('authenticated', …) = true` for all three |
| `column pr.user_id does not exist` | May 13 | Code path fixed |
| `column email_domain_health.window_days does not exist` | May 26 | Schema/caller aligned |
| `missing_unsubscribe` (transactional 400s) | May 13 | Unsubscribe token wiring fixed |
| CookieYes "URL has changed" | May 16 | Domain re-registered |
| `permission denied for get_community_events_health` | May 14 | Granted |

No need to re-fix; just keep monitoring for recurrence in the next 30 days.

### What IS still live (the actual fix list)

Only three signals from late May / early June, narrowly scoped:

1. **`use-autosave` Error: [object Object]** (40 hits, last seen **May 28**)
   - Root cause: `useAutosave` catch passes the raw Error object to `report()` instead of using `serializeError`. Stringification yields `[object Object]`.
   - Fix: replace `String(err)` / `${err}` with `serializeError(err)` (already exists project-wide) in `src/hooks/use-autosave.ts` + add an ESLint rule banning bare `String(err)` / `${err}` inside `catch (err)` blocks.

2. **"We couldn't save your application. Refresh and try again."** (51 hits, last **May 28**)
   - Same root cause family as #1 — `general-application.service.ts` autosave wraps a generic Error around an unserialized cause. Fix is the same `serializeError` swap + propagating the underlying status code so the toast can offer a real recovery hint.

3. **`function digest(text, unknown) does not exist` (code 42883)** (16+4 hits, last **May 28**)
   - Caller passes `digest(text, text)` where the qualified `extensions.digest(bytea, text)` is required after the security-hardening extension move.
   - Fix: grep for all `digest(` callsites in SQL functions/migrations; convert to `extensions.digest(convert_to(<text>, 'UTF8'), 'sha256')`; pin `extensions` into the function's `SET search_path`; add a one-line CI grep guard in `scripts/lint/sql-digest.mjs` (file already exists — extend it).

### Out of scope / not justified by the data

- New `lazyWithRetry` work — already shipped.
- Duplicate-audit dedup work — false alarm.
- Email pacing / DLQ overhaul — token bucket + lane isolation are recent and the log shows the 06:58 burst completed without provider 429s on Jun 3–4 (the 29 × 429s clustered May 13).
- RPC-GRANT CI guard — current GRANTs are correct and the 42501 errors stopped 3 weeks ago. Will revisit only if a recurrence shows up.
- Health-check repetition — these are `audit_log` rows tagged `severity:info` already; they don't reach Triage.

### Shipment

Single migration + service edit + ESLint rule, covering only the three live items above.
