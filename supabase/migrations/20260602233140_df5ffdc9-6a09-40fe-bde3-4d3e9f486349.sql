-- Seed catalog (idempotent)
INSERT INTO public.refactor_kpi_catalog
  (metric_key, label, description, unit, baseline_value, target_value, direction, category, related_section, sort_order)
VALUES
  ('audit_log_error_pct','Audit-log error-class %','Share of audit-log rows tagged severity:error in the last 7 days. Lower is healthier.','percent',7.9,1.5,'lower_is_better','errors','Part 1 §1.1/1.6',10),
  ('profile_updates_30d','Profile updates (30 days)','How many times members saved their profile in the last 30 days. Fewer redundant saves is the goal.','count',21800,6500,'lower_is_better','ux','Part 1 §1.1/1.2, Part 2 §A',20),
  ('profile_edits_per_user_p95','Profile edits per user (p95)','95th-percentile profile-save count per member. High numbers mean people fight the form.','count',27,3,'lower_is_better','ux','Part 2 §A1',30),
  ('profile_edits_within_5min','Profile edits within 5 min of create','Saves within five minutes of account creation — usually signals friction.','count',2015,300,'lower_is_better','ux','Part 2 §A2',40),
  ('task_uncompletion_pct','Task uncompletion rate','Share of completed tasks marked incomplete later.','percent',2.82,0.3,'lower_is_better','ux','Part 2 §B1',50),
  ('general_app_submit_rate','General app submit rate','Share of started general applications that get submitted.','percent',56.9,80,'higher_is_better','ux','Part 2 §G1',60),
  ('signup_post_captcha_completion_pct','Signup completion post-captcha','Share of signup attempts that complete after captcha is ready.','percent',63,95,'higher_is_better','auth','Part 2 §E1',70),
  ('discord_attempts_per_success','Discord attempts per success','Average linking attempts per successful Discord link.','ratio',2.35,1.1,'lower_is_better','ux','Part 2 §D1',80),
  ('admin_notification_peak_per_user_per_week','Admin notifications peak / user / week','Largest weekly notification count any single admin received.','count',283,30,'lower_is_better','ux','Part 2 §F1, Part 1 §1.2',90),
  ('time_to_first_task_avg_minutes','Avg time to first task (min)','Average minutes from signup to first task complete.','minutes',567,10,'lower_is_better','ux','Part 2 §B2',100),
  ('notification_fanout_duplicates','Notification fan-out duplicates','Duplicate notifications blocked by the dedupe index in the last 7 days.','count',1015,0,'lower_is_better','infra','Part 1 §1.2',110),
  ('serviceworker_noise_rows','Service-worker noise rows','Audit-log rows caused by lingering service workers.','count',387,0,'lower_is_better','infra','Part 1 §1.6',120),
  ('chunk_load_brick_sessions','Chunk-load brick sessions','Sessions white-screened on chunk-load failure in the last 7 days.','count',36,0,'lower_is_better','infra','Part 1 §1.5',130),
  ('email_dlq_replay_latency_p95_seconds','Email DLQ replay latency p95 (s)','95th-percentile seconds from a failed email to its successful retry.','count',600,300,'lower_is_better','email','Part 1 §1.3',140),
  ('object_object_log_rows','[object Object] log rows','Audit-log rows literally containing "[object Object]".','count',614,0,'lower_is_better','infra','Part 1 §1.6',150),
  ('captcha_silent_rate_pct','Captcha-silent rate','Share of signup attempts where the captcha widget never reported ready.','percent',28,2,'lower_is_better','auth','Part 2 §E1',200),
  ('announcement_reread_rate','Announcement re-read rate','Average times the same announcement is opened by the same member.','ratio',2.4,1.1,'lower_is_better','ux','Part 2 §C1',210),
  ('avatar_reupload_rate','Avatar re-upload rate','Average avatar uploads per member with at least one upload.','ratio',3.1,1.2,'lower_is_better','ux','Part 2 §J1',220),
  ('freescout_transport_errors_7d','Freescout transport errors (7d)','Help-desk transport failures in the last 7 days.','count',42,5,'lower_is_better','infra','Part 1 §1.7',230),
  ('bulk_cap_rejections_7d','Bulk-cap rejections (7d)','Bulk emails rejected by the per-recipient cap in the last 7 days.','count',57,20,'lower_is_better','email','Part 1 §1.3',240),
  ('email_provider_miss_rate_pct','Email provider miss rate','Share of email sends that got a non-2xx response from the provider.','percent',4.2,1,'lower_is_better','email','Part 1 §1.3',250),
  ('idempotency_replays_7d','Idempotency replays (7d)','Mutating requests served from the idempotency cache instead of running twice.','count',0,500,'higher_is_better','infra','Part 1 §1.2',260),
  ('save_status_coverage_pct','Save-status coverage','Share of editable forms showing a SaveStatus indicator.','percent',35,100,'higher_is_better','ux','Part 2 cross',270),
  ('confirm_dialog_coverage_pct','Confirm-dialog coverage','Share of reversible actions guarded by ConfirmDialog with a verb+object label.','percent',60,100,'higher_is_better','ux','Part 2 cross',280),
  ('login_retry_rate_pct','Login retry rate','Share of logins that needed more than one attempt.','percent',10,3,'lower_is_better','auth','Part 2 §E2',290)
ON CONFLICT (metric_key) DO UPDATE
SET label=EXCLUDED.label, description=EXCLUDED.description, unit=EXCLUDED.unit,
    baseline_value=EXCLUDED.baseline_value, target_value=EXCLUDED.target_value,
    direction=EXCLUDED.direction, category=EXCLUDED.category,
    related_section=EXCLUDED.related_section, sort_order=EXCLUDED.sort_order;

-- v_profile_readiness — drop & recreate to allow column-type evolution
DROP VIEW IF EXISTS public.v_profile_readiness;
CREATE VIEW public.v_profile_readiness
WITH (security_invoker = true)
AS
SELECT
  p.user_id,
  ((CASE WHEN coalesce(nullif(p.first_name,''), '') <> '' THEN 1 ELSE 0 END)
 + (CASE WHEN coalesce(nullif(p.last_name,''),  '') <> '' THEN 1 ELSE 0 END)
 + (CASE WHEN coalesce(nullif(p.country,''),    '') <> '' THEN 1 ELSE 0 END)
 + (CASE WHEN coalesce(nullif(p.timezone,''),   '') <> '' THEN 1 ELSE 0 END)
 + (CASE WHEN coalesce(nullif(p.bio,''),        '') <> '' THEN 1 ELSE 0 END)
 + (CASE WHEN coalesce(nullif(p.avatar_url,''), '') <> '' THEN 1 ELSE 0 END)
 + (CASE WHEN coalesce(nullif(p.discord_username,''), '') <> '' THEN 1 ELSE 0 END)
 + (CASE WHEN coalesce(nullif(p.professional_background,''), '') <> '' THEN 1 ELSE 0 END)
 + (CASE WHEN coalesce(nullif(p.professional_goals,''),     '') <> '' THEN 1 ELSE 0 END)
 + (CASE WHEN p.experience_areas IS NOT NULL AND array_length(p.experience_areas,1) > 0 THEN 1 ELSE 0 END)
  )::int * 10 AS score,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN coalesce(nullif(p.first_name,''), '') = '' THEN 'first_name' END,
    CASE WHEN coalesce(nullif(p.last_name,''),  '') = '' THEN 'last_name'  END,
    CASE WHEN coalesce(nullif(p.country,''),    '') = '' THEN 'country'    END,
    CASE WHEN coalesce(nullif(p.timezone,''),   '') = '' THEN 'timezone'   END,
    CASE WHEN coalesce(nullif(p.bio,''),        '') = '' THEN 'bio'        END,
    CASE WHEN coalesce(nullif(p.avatar_url,''), '') = '' THEN 'avatar_url' END,
    CASE WHEN coalesce(nullif(p.discord_username,''), '') = '' THEN 'discord_username' END,
    CASE WHEN coalesce(nullif(p.professional_background,''), '') = '' THEN 'professional_background' END,
    CASE WHEN coalesce(nullif(p.professional_goals,''), '') = '' THEN 'professional_goals' END,
    CASE WHEN p.experience_areas IS NULL OR array_length(p.experience_areas,1) IS NULL THEN 'experience_areas' END
  ], NULL) AS missing_fields,
  p.onboarded_at,
  p.updated_at
FROM public.profiles p
WHERE
  p.user_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR auth.role() = 'service_role';

GRANT SELECT ON public.v_profile_readiness TO authenticated;
GRANT SELECT ON public.v_profile_readiness TO service_role;