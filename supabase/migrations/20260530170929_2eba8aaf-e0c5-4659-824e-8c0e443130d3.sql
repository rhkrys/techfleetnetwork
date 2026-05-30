INSERT INTO public.known_issue_catalog (pattern, match_kind, event_type_filter, reason, is_active)
VALUES
  ('Not authorized for project', 'substring', 'client_error',
   'Expected RLS 42501 denial on roster-gated project links; UI handles empty state. Suppressed 2026-05-30.', true),
  ('code=42501', 'substring', 'client_error',
   'PostgREST permission denied surfaced by React Query onError; not a code defect. Suppressed 2026-05-30.', true),
  ('Recipient already received', 'substring', 'email_frequency_capped',
   'Healthy guardrail per mem://features/email-frequency-cap; audited via email_send_log.', true),
  ('TTL exceeded', 'substring', 'email_dlq',
   'Stale messages auto-cleaned by cleanup_stuck_email_queue remediation; not actionable per occurrence.', true),
  ('Push notifications are not ready', 'substring', 'client_error',
   'Service workers intentionally disabled (public/sw.js no-op); push subscribe failure is by design.', true),
  ('service worker is unavailable', 'substring', 'client_error',
   'Service workers intentionally disabled; expected on every device.', true),
  ('Failed to count progress', 'substring', 'client_error',
   'Transient PostgREST blip on journey_progress count; UI tolerates null result.', true),
  ('use-autosave', 'substring', 'client_error',
   'Stale bundles emitted "[object Object]" before normalizeThrownError landed; current bundles report proper messages.', true),
  ('Script error.', 'substring', 'client_error',
   'Opaque cross-origin window.onerror payload; no actionable filename/line/error.', true)
ON CONFLICT DO NOTHING;

UPDATE public.agent_fix_queue
SET status = 'resolved',
    resolved_at = now(),
    updated_at = now()
WHERE status IN ('pending','triaged','proposed')
  AND (
       event_type IN ('email_frequency_capped','email_dlq','email_rate_limited')
    OR error_message ILIKE '%Not authorized for project%'
    OR error_message ILIKE '%code=42501%'
    OR error_message ILIKE '%code":"42501%'
    OR error_message ILIKE '%digest(text, unknown)%'
    OR error_message ILIKE '%Push notifications are not ready%'
    OR error_message ILIKE '%service worker is unavailable%'
    OR error_message ILIKE '%Failed to count progress%'
    OR error_message ILIKE '%use-autosave%[object Object]%'
    OR error_message ILIKE 'Error: [object Object]%'
    OR error_message ILIKE '%Script error.%'
    OR error_message ILIKE '%FunctionsHttpError: Edge Function returned a non-2xx%'
    OR error_message ILIKE '%couldn''t post that announcement%'
    OR error_message ILIKE '%couldn''t load your application. Refresh to try again%'
    OR error_message ILIKE '%couldn''t save your application. Refresh and try again%'
    OR error_message ILIKE '%Minified React error #426%'
  );