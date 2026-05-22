-- Raise email queue throughput so opt-in announcement broadcasts drain within TTL.
-- Root cause of recent email_dlq events: 87 announcement emails enqueued in a
-- burst hit the 50/hour global bulk cap; the tail sat in queue until the 60-min
-- transactional TTL expired and was moved to the DLQ.
--
-- Fix: raise the hourly bulk cap, extend the transactional TTL, and increase
-- batch size / decrease send delay so a single announcement broadcast can
-- complete well within the TTL window. Per-recipient frequency cap and
-- bulk_paused circuit breaker are unchanged.
UPDATE public.email_send_state
SET
  bulk_hourly_cap = 500,
  transactional_email_ttl_minutes = 240,
  batch_size = 25,
  send_delay_ms = 100,
  updated_at = now()
WHERE id = 1;