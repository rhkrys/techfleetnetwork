-- P1 Infrastructure-as-code: make the backend's non-schema infra reproducible.
--
-- The 2026-07-08 firefight proved these were created imperatively (dashboard /
-- Lovable Management API) and never carried to the new project: pg_cron was off,
-- pgmq queues q_auth_emails/q_bulk_emails were missing. This migration declares
-- them idempotently so a fresh `supabase db reset` reproduces the whole backend
-- (extensions + queues + — via 20260707200000 — the cron registry) with zero
-- dashboard clicks. Safe to run repeatedly.

-- Extensions (IF NOT EXISTS = no-op when already enabled).
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pgmq;

-- pgmq email queues used by the v2 pipeline. pgmq.create() has no IF NOT EXISTS,
-- so guard on the backing table so re-runs are no-ops.
DO $$
BEGIN
  IF to_regclass('pgmq.q_auth_emails') IS NULL THEN
    PERFORM pgmq.create('auth_emails');
  END IF;
  IF to_regclass('pgmq.q_transactional_emails') IS NULL THEN
    PERFORM pgmq.create('transactional_emails');
  END IF;
  IF to_regclass('pgmq.q_bulk_emails') IS NULL THEN
    PERFORM pgmq.create('bulk_emails');
  END IF;
END $$;
