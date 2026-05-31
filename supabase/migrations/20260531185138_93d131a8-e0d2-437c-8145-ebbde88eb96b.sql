
-- 1. Create dedicated bulk queue + DLQ (idempotent)
DO $$ BEGIN PERFORM pgmq.create('bulk_emails'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('bulk_emails_dlq'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 2. Add bulk-lane state columns
ALTER TABLE public.email_send_state
  ADD COLUMN IF NOT EXISTS bulk_retry_after_until timestamptz,
  ADD COLUMN IF NOT EXISTS bulk_consecutive_rate_limits integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bulk_batch_size integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS bulk_send_delay_ms integer NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS bulk_email_ttl_minutes integer NOT NULL DEFAULT 240;

-- 3. Clear the currently-stuck transactional cooldown so the backlog drains right now
UPDATE public.email_send_state
SET transactional_retry_after_until = NULL,
    transactional_consecutive_rate_limits = 0,
    retry_after_until = NULL,
    updated_at = now()
WHERE id = 1;
