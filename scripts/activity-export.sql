-- =============================================================================
-- activity-export.sql
-- -----------------------------------------------------------------------------
-- Repeatable export + pattern-analysis queries for the platform activity log.
--
-- Run in the Supabase SQL Editor (new project: pzvqxdgoztbfikfuifix), then use
-- the "Download CSV" button on the results pane to export each result set.
--
-- WHY THIS EXISTS
--   The admin Activity Log page (src/pages/ActivityLogPage.tsx) reads a single
--   table: public.audit_log. Its in-app "Download CSV" button batch-pulls the
--   same rows client-side, but fails under load. These queries are the
--   server-side equivalent, plus pre-aggregated rollups for the retention
--   pattern analysis.
--
-- HOW TO READ THE DATA (critical — see src/services/error-reporter.service.ts)
--   audit_log is a CURATED sink, not a raw firehose. Client errors pass through
--   suppression -> dedup (60s) -> rate-limit (10/min/tab, scaled to as low as
--   10% under load) -> escalate-after-N -> severity downgrade before they land.
--   So raw counts are a FLOOR, not the true rate. The aggregate meta-events in
--   query (B2) are the real error-volume signal. The highest-risk failures
--   (auth-token lock contention, stale-bundle, DB overload) are suppressed or
--   downgraded OUT of audit_log entirely — cover those via ops_events and
--   login_attempts in section C.
--
-- COLUMN NOTES (verified against supabase/migrations)
--   audit_log         -> created_at   (purged at 90 days by audit-log-daily-purge)
--   ops_events        -> occurred_at  (purged at 90 days)
--   login_attempts    -> created_at
--   failed_login_attempts -> attempted_at   (NOT created_at)
--   changed_fields is text[]; metadata is packed as 'key:value' strings,
--   e.g. 'source:edge.process-email-queue', 'severity:error', 'trace:<id>',
--   'field:<name>', 'schema:<name>'.
--
-- CAVEATS
--   * "Since the first log" is effectively a rolling ~90-day window (purge cron).
--   * Client-error history before ~May 2026 is unreliable: a nil-UUID bug
--     silently dropped every authenticated client_error until it was fixed.
--   * Confirm whether history was carried from the old Lovable project; the
--     migration primarily copied auth.users / profiles / storage.
-- =============================================================================


-- =============================================================================
-- SECTION A — RAW EXPORT (mirrors the in-app Download CSV button)
-- =============================================================================

-- A1. Full raw activity log. No LIMIT — returns everything, newest first.
--     Contains PII (user_id, actor_email). Use the no-PII rollups in B/C if you
--     would rather not ship identifiers.
select
  created_at,
  event_type,
  table_name,
  record_id,
  user_id,
  actor_email,
  changed_fields,
  error_message,
  error_fingerprint,
  id
from public.audit_log
order by created_at desc;


-- =============================================================================
-- SECTION B — AUDIT_LOG ROLLUPS (no PII; safe to paste back for analysis)
-- =============================================================================

-- B1. Master trend: volume & shape per week per event type.
select date_trunc('week', created_at) as wk, event_type, count(*) as n
from public.audit_log
group by 1, 2
order by 1, 2;

-- B2. *** Error-storm proxy *** — the aggregate meta-events. Spikes here reveal
--     error storms the log otherwise refuses to record. Most important chart.
select date_trunc('day', created_at) as d, event_type, count(*) as n
from public.audit_log
where event_type in (
  'client_error_overflow',
  'client_error_suppressed',
  'client_error_deduped',
  'audit_pressure_changed'
)
group by 1, 2
order by 1, 2;

-- B3. DB-instability curve (the original June-2026 root cause). PGRST002,
--     statement-timeout 57014, too-many-connections 53300, 429s all land here.
select date_trunc('week', created_at) as wk, count(*) as infra_transient_n
from public.audit_log
where event_type = 'infra_transient'
group by 1
order by 1;

-- B4. Frustration signal: validator false-positives that blocked real input.
--     (Empty-required-field rejections are filtered out at source, so what
--     remains is regex/refine bugs rejecting input the user believed valid.)
select
  date_trunc('week', created_at) as wk,
  (select f from unnest(changed_fields) f where f like 'field:%' limit 1) as field,
  count(*) as n
from public.audit_log
where event_type = 'validation_rejected'
group by 1, 2
order by 3 desc;

-- B5. Repeated actions by the same user in a day (frustration / retry signal).
--     Business events are NOT deduped, so this is a valid repeat measure.
select user_id, event_type, date_trunc('day', created_at) as d, count(*) as n
from public.audit_log
group by 1, 2, 3
having count(*) > 5
order by n desc
limit 200;

-- B6. Failures & errors by week (auth, email, edge, and anything with a message).
select date_trunc('week', created_at) as wk, event_type, count(*) as n
from public.audit_log
where event_type ~ '(_failed|_error|_denied|unauthorized|bounced|dlq)$'
   or error_message is not null
group by 1, 2
order by 1, 3 desc;

-- B7. Top recurring errors by fingerprint (which defects dominate).
select error_fingerprint, count(*) as n,
       min(created_at) as first_seen, max(created_at) as last_seen
from public.audit_log
where error_fingerprint is not null
group by 1
order by n desc
limit 100;

-- B8. Daily total volume (overall activity heartbeat / gaps).
select date_trunc('day', created_at) as d, count(*) as n
from public.audit_log
group by 1
order by 1;


-- =============================================================================
-- SECTION C — COMPANION TABLES (where the suppressed high-risk signals live)
-- =============================================================================

-- C1. ops_events: errors/warnings the audit_log suppresses or downgrades.
select date_trunc('week', occurred_at) as wk, severity, kind, count(*) as n
from public.ops_events
group by 1, 2, 3
order by 1, 2, 3;

-- C2. login_attempts: success vs failure rate, latency, and failure branch.
--     (email_hash / ip_hash only — no raw PII.)
select date_trunc('week', created_at) as wk,
       outcome,
       count(*) as n,
       round(avg(duration_ms)) as avg_ms,
       percentile_disc(0.95) within group (order by duration_ms) as p95_ms
from public.login_attempts
group by 1, 2
order by 1, 2;

-- C3. login_attempts: which failure branch / HTTP status dominates (the "why").
select branch, http_status, count(*) as n
from public.login_attempts
where outcome <> 'success'
group by 1, 2
order by n desc;

-- C4. login_attempts: same person failing repeatedly (lockout / frustration).
select email_hash, count(*) as n,
       min(created_at) as first_seen, max(created_at) as last_seen
from public.login_attempts
where outcome <> 'success'
group by 1
having count(*) > 5
order by n desc;

-- C5. failed_login_attempts: weekly failed-login volume (note: attempted_at).
select date_trunc('week', attempted_at) as wk, count(*) as failed
from public.failed_login_attempts
group by 1
order by 1;
