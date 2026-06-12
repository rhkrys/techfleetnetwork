CREATE OR REPLACE FUNCTION public.member_progress_self_check()
RETURNS TABLE (
  auth_user_id uuid,
  journey_rows bigint,
  completed_rows bigint,
  course_completion_rows bigint,
  badge_rows bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    auth.uid() AS auth_user_id,
    (SELECT count(*) FROM public.journey_progress jp WHERE jp.user_id = auth.uid())::bigint AS journey_rows,
    (SELECT count(*) FROM public.journey_progress jp WHERE jp.user_id = auth.uid() AND jp.completed = true)::bigint AS completed_rows,
    (SELECT count(*) FROM public.course_completions cc WHERE cc.user_id = auth.uid())::bigint AS course_completion_rows,
    (SELECT count(*) FROM public.badges_awarded ba WHERE ba.user_id = auth.uid())::bigint AS badge_rows;
$$;

REVOKE ALL ON FUNCTION public.member_progress_self_check() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_progress_self_check() TO authenticated, service_role;

INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('Journey identity', 41, 'JOURNEY-IDENTITY-001',
   'Completed member courses render as completed after sign-in',
   E'Given a member has previously completed required course lessons and course completion records
When the member signs in and opens Courses or My journey
Then [UI] every previously completed course renders as Complete with the correct completed task count
And [DB] member_progress_self_check() returns journey_rows greater than 0 and completed_rows equal to the member completed journey rows visible to auth.uid()
And [Code] journey_progress and course_completions reads filter with the SDK session user id, not profile.id',
   'implemented', 'manual',
   'scripts/ci/check-progress-identity-sql-smoke.mjs, scripts/ci/check-progress-read-identity.mjs',
   'Regression guard for completed courses rendering as not started after auth/session changes.'),
  ('Journey identity', 41, 'JOURNEY-IDENTITY-002',
   'Progress cache clears on every auth identity transition',
   E'Given progress-related React Query entries exist for a prior auth state
When auth identity changes, including signed out to signed in after SDK hydration
Then [UI] journey and course surfaces refetch before showing stale completion state
And [DB] no journey_progress, course_completions, or badge rows are created, changed, or deleted by the cache guard
And [Code] ProgressCacheIdentityGuard removes journey, course-completion, badge, and quest progress cache families while leaving unrelated cache entries intact',
   'implemented', 'unit',
   'src/components/__tests__/ProgressCacheIdentityGuard.test.tsx',
   'Covers account switch and signed-out to signed-in hydration cache drift.'),
  ('Journey identity', 41, 'JOURNEY-IDENTITY-003',
   'Progress reads cannot use profile primary keys',
   E'Given the source tree contains client reads for journey and course progress tables
When CI scans the codebase
Then [UI] course cards and journey steps are protected from silent not-started regressions caused by wrong identity reads
And [DB] RLS remains scoped to auth.uid() = user_id for member progress visibility
And [Code] CI fails if progress table reads filter user_id with profile.id, profile?.id, currentProfile.id, or p.id',
   'implemented', 'unit',
   'scripts/ci/check-progress-read-identity.mjs',
   'Static guard against profile PK/session user ID drift.')
ON CONFLICT (scenario_id) DO UPDATE
SET title = EXCLUDED.title,
    gherkin = EXCLUDED.gherkin,
    status = EXCLUDED.status,
    test_type = EXCLUDED.test_type,
    test_file = EXCLUDED.test_file,
    notes = EXCLUDED.notes,
    updated_at = now();