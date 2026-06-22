## Why everything feels slow

Lovable Cloud reports healthy. The slowdown is **client-side write storms saturating the Postgres connection pool**, so every interactive call (login `/token`, MFA `/factors`, class insert, project update) waits in a PostgREST queue. Top offenders from `pg_stat_statements`:

| # | Query                                                                              | Calls    | Total time | Max latency |
| - | ---------------------------------------------------------------------------------- | -------- | ---------- | ----------- |
| 1 | `web_vital_samples` INSERT (every LCP/INP/CLS/FCP/TTFB beacon, **per nav**)        | 43,683   | 33 min     | 7.9 s       |
| 2 | `ugc_translations` paginated SELECT **with exact COUNT** (`pgrst_source_count`)    | 69,433   | 59 min     | 7.9 s       |
| 3 | `i18n_translations` lookup by `(locale, namespace, key=ANY)`                       | 19,313   | 11 min     | 6.7 s       |
| 4 | `cookie_consents` INSERT (firing on every page load, not just on change)           | 9,123    | 5 min      | 5.9 s       |
| 5 | `journey_progress` upsert (chained to many UI events)                              | 11,400   | 14 min     | 7.9 s       |
| 6 | `email_send_state` + `pgmq` + `vault.decrypted_secrets` poller (cron, **~13/sec**) | 1.5 M    | 17 min     | 0.8 s       |
| 7 | `audit_log` exact-count from PostgREST (Activity Log — already fixed last turn)    | 277      | 3 min      | 2.8 s       |
| 8 | `get_member_continent_distribution()` RPC (no cache)                               | 484      | 3 min      | 7.3 s       |
| 9 | `lesson_video_events` INSERT (per heartbeat)                                       | 3,890    | 4 min      | 7.0 s       |

The 7-8 s max latencies on **simple single-row inserts** confirm pool saturation, not query cost. Auth + 2FA traffic is competing with the same pool. Fix the writers, every screen gets faster.

## Permanent fix — root cause, no band-aids

### 1. Web Vitals beacon (biggest win) — batched edge sink
- New edge fn `record-web-vitals-batch` accepts up to 50 samples in one POST; writes into `web_vital_samples` in a single multi-row insert.
- Client `src/lib/web-vitals/beacon.ts` buffers in memory, flushes every 10 s, on `visibilitychange=hidden`, and on `pagehide`, via `navigator.sendBeacon` (non-blocking).
- Drop direct PostgREST inserts from the client. Sample-rate 25% for non-error vitals.
- Expected: **~95% drop** in this query's call count.

### 2. `ugc_translations` reads — kill the exact COUNT
- Replace PostgREST `.select(..., { count: 'exact' })` with a thin RPC `get_ugc_translations_page(p_since, p_limit)` returning rows only.
- Where total is needed, call `audit_log_count_fast`-style estimate via new `ugc_translations_count_fast()`.
- Audit grep: `rg "from\(\"ugc_translations\"\).*count: ?\"exact\""`.

### 3. `i18n_translations` lookup — composite index + LRU cache
- Add `CREATE INDEX IF NOT EXISTS idx_i18n_translations_locale_ns_key ON public.i18n_translations (locale, namespace, key)` (covering predicate `WHERE locale=$ AND namespace=$ AND key=ANY($)`).
- Add 5-minute in-memory LRU in `src/lib/i18n/translations-cache.ts` keyed on `locale:namespace:key` so repeated DOM-translator passes don't re-query.

### 4. `cookie_consents` — insert only on change
- `src/lib/consent/recordConsent.ts`: hash `{categories, gpc_signal, policy_version}`; skip the write if the hash matches the value stored in `localStorage('tfn:consent-hash')`.
- Server-side guard: drop duplicate consecutive rows for the same `(user_id|anon_id, hash)` inside the existing `record-consent` edge fn.

### 5. `journey_progress` upsert — debounce + de-dup
- `src/services/journey.service.ts`: 750 ms trailing debounce per `(user_id, phase, task_id)`; collapse repeated identical upserts; one-flight guard.

### 6. Email NOTIFY cron — slow the loop, memoize the secret
- Today the cron query runs ~13/sec calling `vault.decrypted_secrets` every tick.
- Migration: lower the schedule from every 5 s to every 30 s and cache `decrypted_secret` in a `STABLE SECURITY DEFINER` function `_internal_get_email_dispatcher_token()` so PG only fetches it once per backend.
- Net: ~85% fewer `vault` reads, same dispatch SLO (queue drain in <60 s).

### 7. `get_member_continent_distribution()` — daily snapshot
- New table `member_continent_distribution_daily (snapshot_date primary key, payload jsonb, refreshed_at)`.
- Refresh via existing `refresh-network-stats` cron at 02:00 UTC.
- Public reads hit the snapshot row (single jsonb fetch). RPC kept as fallback behind admin flag.

### 8. `lesson_video_events` — sampled flush
- Currently posted every heartbeat. Buffer client-side in 30 s windows; flush as one row per `(user_id, lesson_id, window_start)` with `position_seconds_max`.

## What does NOT change (no UX regression)

- No login, MFA, sign-up, password reset, or session flow changes.
- No DOM-translator behavior change (only the cache layer underneath it).
- No reduction in Web Vitals fidelity for **error/poor-rated** samples (those bypass the 25% sampler).
- No retention or RLS changes on any table.

## Files

- `src/lib/web-vitals/beacon.ts` *(new)* + replace direct inserts in `src/main.tsx` / `src/lib/web-vitals/init.ts`.
- `supabase/functions/record-web-vitals-batch/index.ts` *(new)* + `config.toml` pin.
- `src/lib/i18n/translations-cache.ts` *(new)* + wired into `src/services/i18n-runtime.ts`.
- `src/lib/consent/recordConsent.ts` *(edit)*.
- `src/services/journey.service.ts` *(edit — debounce wrapper)*.
- `supabase/migrations/<ts>_perf_storm_fix.sql` — composite indexes, `ugc_translations_count_fast()`, `get_ugc_translations_page()`, `_internal_get_email_dispatcher_token()`, snapshot table + grants + RLS, cron schedule change.
- `src/services/stats.service.ts` *(edit — read snapshot)*.
- `src/lib/video/heartbeat-buffer.ts` *(new)*.
- Tests: `src/test/lib/web-vitals-beacon.test.ts`, `src/test/lib/journey-debounce.test.ts`, `src/test/lib/consent-dedupe.test.ts`, `src/test/services/stats-snapshot.test.ts`.
- `public.bdd_scenarios` — `PERF-STORM-001..009`.

## Receipts after build

- `pg_stat_statements` re-snapshot: top-5 totals drop by ≥80% within 1 hour.
- Login `/token` p95 returns under 800 ms on the published URL.
- No direct PostgREST inserts into `web_vital_samples` or `cookie_consents` from `src/` (greppable).
- 9 BDD scenarios + 4 vitest specs green.

## Out of scope

- Connection-pool sizing / compute upgrade — fixing the writers makes that unnecessary; we'll only revisit if the receipts above don't clear the queue.
- Activity Log count (shipped last turn).
- Member world map additive source (unrelated).
