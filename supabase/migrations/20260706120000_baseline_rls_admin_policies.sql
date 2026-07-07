-- Baseline Restoration — missing admin RLS policies
-- Source: docs/baseline-restoration-prd.md (D-1). Idempotent; apply with
-- `supabase db push`. These policies existed on the old Lovable-era project via
-- dashboard config but did not reproduce in the migration files, so on the
-- rebuilt project admins are silently blocked from two operations.
--
-- Scope note (fix-at-the-right-layer): the audit also flagged "anon can't read
-- network_stats_* / course_catalog" — that is NOT fixed here on purpose. Those
-- surfaces are read through SECURITY DEFINER RPCs (e.g. public.get_network_stats,
-- already GRANTed EXECUTE to anon) which bypass table RLS. The blank logged-out
-- stats are a MISSING-SECRET problem (AIRTABLE_* for sync-airtable-network-stats),
-- handled in the secrets checklist — not an RLS gap. Adding anon table SELECT
-- would be dead code and needless surface, so it is intentionally omitted.

-- =============================================================================
-- 1. project_applications — admins must be able to change applicant status
--    (accept / invite / reject) and remove bad submissions. Today only a
--    user-scoped "update own" policy exists, so admin status changes are denied.
-- =============================================================================
DROP POLICY IF EXISTS "Admins can update project applications" ON public.project_applications;
CREATE POLICY "Admins can update project applications"
  ON public.project_applications
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can delete project applications" ON public.project_applications;
CREATE POLICY "Admins can delete project applications"
  ON public.project_applications
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- =============================================================================
-- 2. general_applications — admins must be able to read all submissions to
--    review them. Today only a user-scoped "view own" SELECT policy exists, so
--    the admin applications view returns empty. Mirrors the working admin SELECT
--    policy already present on project_applications.
-- =============================================================================
DROP POLICY IF EXISTS "Admins can view all general applications" ON public.general_applications;
CREATE POLICY "Admins can view all general applications"
  ON public.general_applications
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Verification (run after apply, as an admin JWT and a non-admin JWT):
--   admin   : SELECT count(*) FROM public.general_applications;                 -- > 0
--   admin   : UPDATE public.project_applications SET status = status WHERE id = <id>; -- allowed
--   non-admin: same UPDATE on another user's row                                -- denied (0 rows)
