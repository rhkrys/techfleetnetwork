
-- Part 2 §G1 — Resumable general-application view powers the dashboard banner.
-- security_invoker=true so RLS on the underlying table is enforced (the
-- general_applications policies already scope to auth.uid()).

CREATE OR REPLACE VIEW public.v_resumable_general_applications
WITH (security_invoker = true) AS
SELECT
  ga.id,
  ga.user_id,
  ga.status,
  ga.current_section,
  ga.draft_updated_at,
  ga.updated_at,
  COALESCE(ga.draft_updated_at, ga.updated_at) AS last_touched_at,
  EXTRACT(EPOCH FROM (now() - COALESCE(ga.draft_updated_at, ga.updated_at)))::bigint AS seconds_since_touch,
  (ga.draft_state IS NOT NULL AND ga.draft_state <> '{}'::jsonb) AS has_draft_payload
FROM public.general_applications ga
WHERE ga.completed_at IS NULL
  AND ga.status IS DISTINCT FROM 'submitted';

GRANT SELECT ON public.v_resumable_general_applications TO authenticated;

COMMENT ON VIEW public.v_resumable_general_applications IS
  'Per-member unfinished general applications; powers the dashboard "Resume application" banner (Part 2 §G1).';
