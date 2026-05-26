ALTER TABLE public.email_domain_health
  ADD COLUMN IF NOT EXISTS window_days integer NOT NULL DEFAULT 7;

UPDATE public.email_domain_health
SET window_days = GREATEST(1, CEIL(EXTRACT(EPOCH FROM (window_end - window_start)) / 86400.0)::integer)
WHERE window_start IS NOT NULL
  AND window_end IS NOT NULL;

ALTER TABLE public.email_domain_health
  ADD CONSTRAINT email_domain_health_window_days_positive
  CHECK (window_days BETWEEN 1 AND 365);