-- Fix: admin-gated service-role edge functions returned 403 for real admins.
--
-- notify-applicant-status (and other service-role workers) authorize by calling
-- `has_role(user_id, 'admin')` via the service-role client and swallowing any
-- RPC error — so if the call errors, `!isAdmin` is true → 403. On this project
-- `has_role` was granted EXECUTE only to `authenticated` (for RLS), NOT to
-- `service_role`, so the edge function's call was permission-denied → null →
-- 403, even though the user genuinely holds the admin role. (Ran fine in the
-- SQL editor because that executes as `postgres`.)
--
-- Root layer: database grants, not the edge function. This affects EVERY
-- service-role function that gates on has_role (notify-applicant-status,
-- admin-purge-auth-user, revoke-user-sessions, etc.) — not just status changes.
--
-- Grant EXECUTE on every has_role overload to service_role. Idempotent.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'has_role'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.has_role(%s) TO service_role', r.args);
  END LOOP;
END $$;
