-- Drop catalog rows whose keys aren't produced by snapshot_refactor_kpis
DELETE FROM public.refactor_kpi_catalog
 WHERE metric_key IN (
   'captcha_silent_rate_pct',
   'freescout_transport_errors_7d',
   'login_retry_rate_pct',
   'announcement_reread_rate',
   'avatar_reupload_rate',
   'bulk_cap_rejections_7d',
   'email_provider_miss_rate_pct',
   'idempotency_replays_7d',
   'save_status_coverage_pct',
   'confirm_dialog_coverage_pct'
 );

-- Upsert canonical catalog rows for every snapshot-produced metric
INSERT INTO public.refactor_kpi_catalog
  (metric_key, label, description, unit, baseline_value, target_value, direction, category, related_section, sort_order)
VALUES
  ('captcha_silent_block_count','Captcha-silent signups blocked','Signup attempts blocked because the captcha widget never reported ready.','count',29,2,'lower_is_better','auth','Part 2 §E1',200),
  ('freescout_transport_errors','Freescout transport errors (7d)','Help-desk transport failures in the last 7 days.','count',42,5,'lower_is_better','infra','Part 1 §1.7',230),
  ('login_retry_pct','Login retry rate','Share of logins that needed more than one attempt.','percent',10,3,'lower_is_better','auth','Part 2 §E2',290),
  ('announcement_reread_count','Announcement re-read count','Repeat reads recorded against the same announcement by the same member.','count',140,20,'lower_is_better','ux','Part 2 §C1',210),
  ('avatar_reupload_max_per_user','Avatar re-upload max / user','Largest number of avatar uploads any single member did.','count',70,3,'lower_is_better','ux','Part 2 §J1',220),
  ('rapid_repeat_writes','Rapid repeat writes (7d)','Mutating requests within 250ms of an identical previous request — collapsed by the idempotency engine.','count',773,50,'lower_is_better','infra','Part 1 §1.2',115),
  ('email_frequency_capped_count','Bulk emails skipped by cap (7d)','Bulk emails (project blast / Fleety digest) skipped because the per-recipient cap was reached.','count',57,20,'lower_is_better','email','Part 1 §1.3, Part 2 §I1',245),
  ('email_rate_limited_count','Email provider rate-limited (7d)','Email sends paused because the provider returned a 429 in the last 7 days.','count',12,2,'lower_is_better','email','Part 1 §1.3',255),
  ('email_failed_count','Email failures (7d)','Email sends that ended in failed/DLQ in the last 7 days.','count',8,1,'lower_is_better','email','Part 1 §1.3',265),
  ('useauth_provider_misses','useAuth provider misses','White-screens caused by useAuth being called above the provider.','count',20,0,'lower_is_better','infra','Part 1 §1.5',135)
ON CONFLICT (metric_key) DO UPDATE
SET label=EXCLUDED.label, description=EXCLUDED.description, unit=EXCLUDED.unit,
    baseline_value=EXCLUDED.baseline_value, target_value=EXCLUDED.target_value,
    direction=EXCLUDED.direction, category=EXCLUDED.category,
    related_section=EXCLUDED.related_section, sort_order=EXCLUDED.sort_order;