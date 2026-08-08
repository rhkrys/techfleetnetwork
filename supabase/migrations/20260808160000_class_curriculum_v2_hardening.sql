-- ============================================================================
-- Class Curriculum v2 — Slice 1: authorization hardening (no user-visible change)
--
-- Feature: Allow Teachers to Develop Custom Curriculum Modules (Classes MVP).
-- Additive / expand-phase (release-deployment-safety): CREATE OR REPLACE of one
-- existing function + one new function. No table, column, policy, or RPC
-- signature changes; the existing write RPCs are left byte-for-byte unchanged.
--
-- Scope is deliberately minimal (CLAUDE.md directive 4 "smallest change"):
--   * F3 — teacher un-approval must revoke authoring. The live
--     `_assert_class_editor` authorizes on ownership OR admin and never
--     re-checks the 'teacher' role, so a class owner whose teacher role was
--     revoked can still edit curriculum. AC Business-Logic rule #4 requires the
--     opposite: losing approval immediately removes curriculum-management
--     ability. Fixed by requiring CURRENT teacher standing (or admin).
--   * F2 — introduce an `is_class_learner()` entitlement SEAM. Its body here
--     MIRRORS today's `is_enrolled_in_class()` exactly (any cohort
--     registration) so it is a behavioral no-op now; the Gumroad-entitlement
--     ticket replaces ONLY this body without touching any downstream policy or
--     RPC. Entitlement tightening is explicitly out of scope for this ticket
--     (AC "Decisions Made" #5).
--
-- Optimistic concurrency (F8) and bounded audit (F9) from the reference design
-- are intentionally NOT included: neither is an AC requirement and authoring is
-- owner-only, so there are no concurrent editors to protect against yet.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- F3: authoring requires CURRENT teacher standing (or admin). Same signature
--     and return type as the live function — this only tightens the predicate.
--     Class owners are teachers by construction (only teachers can create a
--     class, behind TeacherRoute), and the existing handle_teacher_role_revocation
--     trigger already archives a teacher's classes on revocation, so requiring
--     the role here is consistent with established behavior — it closes the gap
--     for any class that outlives the role (e.g. archived-but-owned).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._assert_class_editor(_class_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  -- Admins may manage any class's curriculum.
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN;
  END IF;
  -- A teacher may manage curriculum only for classes they own, and only while
  -- they still hold the 'teacher' role (approval is ongoing, not one-time).
  IF public.is_class_owner(_class_id, auth.uid())
     AND public.has_role(auth.uid(), 'teacher') THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
END $$;
-- Grants unchanged from the original definition (REVOKE-from-PUBLIC only; the
-- function is invoked via SECURITY DEFINER RPCs, not granted to authenticated).
REVOKE ALL ON FUNCTION public._assert_class_editor(uuid) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- F2: entitlement seam. MVP body == is_enrolled_in_class() (any cohort
--     registration for the class). This is the single line the Gumroad ticket
--     will replace with a verified-purchase check; nothing downstream depends
--     on the body, only on the function's name + signature.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_class_learner(_class_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- MVP entitlement mirrors existing enrollment exactly (no tightening this
  -- ticket). TODO(gumroad-entitlement): replace with verified paid registration.
  SELECT EXISTS (
    SELECT 1
    FROM public.cohort_registrations r
    JOIN public.cohorts co ON co.id = r.cohort_id
    WHERE co.class_id = _class_id AND r.user_id = _user_id
  );
$$;
REVOKE ALL ON FUNCTION public.is_class_learner(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_class_learner(uuid, uuid) TO authenticated, service_role;
