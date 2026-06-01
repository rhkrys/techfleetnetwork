-- Normalize legacy non-standard email_send_log statuses into the canonical set
-- so the infra setup can re-apply its status_check constraint. Preserve the
-- original status in metadata for audit.
UPDATE public.email_send_log
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('original_status', status),
    status = CASE
      WHEN status = 'frequency_capped' THEN 'suppressed'
      WHEN status = 'rate_limited' THEN 'failed'
      ELSE status
    END
WHERE status IN ('frequency_capped', 'rate_limited');