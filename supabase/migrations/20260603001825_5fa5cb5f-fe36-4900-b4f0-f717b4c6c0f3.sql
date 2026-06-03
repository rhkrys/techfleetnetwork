
ALTER TABLE public.general_applications
  ADD COLUMN IF NOT EXISTS resume_reminder_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_general_applications_draft_stale
  ON public.general_applications (updated_at)
  WHERE status = 'draft' AND resume_reminder_sent_at IS NULL;

INSERT INTO public.email_templates (slug, lane, purpose, default_headers, frequency_cap_applies, list_unsubscribe_path, notes)
VALUES (
  'resume-application',
  'transactional_emails',
  'application_reminder',
  '{"Precedence":"bulk"}'::jsonb,
  false,
  '/settings/notifications',
  '48h reminder for stale draft general applications. Sent at most once per application via resume_reminder_sent_at gate.'
)
ON CONFLICT (slug) DO UPDATE
  SET lane = EXCLUDED.lane,
      purpose = EXCLUDED.purpose,
      default_headers = EXCLUDED.default_headers,
      frequency_cap_applies = EXCLUDED.frequency_cap_applies,
      list_unsubscribe_path = EXCLUDED.list_unsubscribe_path,
      notes = EXCLUDED.notes,
      updated_at = now();
