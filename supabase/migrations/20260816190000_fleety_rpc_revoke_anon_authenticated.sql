-- SECURITY: close a live IDOR / privilege gap on two SECURITY DEFINER Fleety RPCs.
--
-- 20260804220000 hardened fleety_load_user_memories + fleety_observe_synonym (search_path='')
-- and did REVOKE ALL ... FROM PUBLIC. But Supabase ALSO grants EXECUTE to the anon +
-- authenticated roles EXPLICITLY (via default privileges), so a PUBLIC-only revoke left both
-- functions callable by any anon/authenticated caller through the PostgREST `rpc` endpoint.
-- Confirmed in prod: has_function_privilege('authenticated'|'anon', ...) = true for both.
--
-- Impact:
--   * fleety_load_user_memories(p_user_id uuid) is DEFINER and does NOT bind to auth.uid() —
--     it returns whatever user_id you pass. Executable by `authenticated` ⇒ any logged-in
--     member could read ANY member's stored memories (IDOR / broken object-level authz).
--   * fleety_observe_synonym is a DEFINER writer — executable by anon/authenticated ⇒ synonym
--     data pollution.
--
-- Fix: REVOKE EXECUTE from anon + authenticated (and re-assert FROM PUBLIC) so ONLY service_role
-- (the edge functions) can call them. Explicit revoke removes the explicit grant that the
-- PUBLIC revoke could not. Idempotent; body/search_path unchanged.

REVOKE EXECUTE ON FUNCTION public.fleety_load_user_memories(uuid)
  FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fleety_observe_synonym(text, text, text, int)
  FROM anon, authenticated, PUBLIC;

-- Re-assert the only intended caller.
GRANT EXECUTE ON FUNCTION public.fleety_load_user_memories(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fleety_observe_synonym(text, text, text, int) TO service_role;
