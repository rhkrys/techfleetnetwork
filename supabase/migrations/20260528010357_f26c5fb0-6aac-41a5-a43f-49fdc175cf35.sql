ALTER TABLE public.email_send_state
  ADD COLUMN IF NOT EXISTS auth_retry_after_until timestamptz,
  ADD COLUMN IF NOT EXISTS transactional_retry_after_until timestamptz,
  ADD COLUMN IF NOT EXISTS auth_consecutive_rate_limits integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transactional_consecutive_rate_limits integer NOT NULL DEFAULT 0;