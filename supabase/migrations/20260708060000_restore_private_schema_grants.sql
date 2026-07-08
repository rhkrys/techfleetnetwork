-- Restore app-role access to the `private` schema — the real cause of the
-- recruiting-center "We couldn't update the status" 403 AND the recurring
-- "AuthError: permission denied for schema private" (35 hits in the
-- 2026-06-15..07-07 activity log).
--
-- public.has_role() is a SECURITY-wrapper that delegates to
-- private.has_role(). When service_role (edge functions) or authenticated
-- (client) lack USAGE on schema `private` + EXECUTE on its functions, that
-- inner call fails with `permission denied for schema private`. In
-- notify-applicant-status the RPC error is swallowed → `!isAdmin` → 403, even
-- for genuine admins.
--
-- These exact grants already exist in 20260625120000_fleety_rearchitecture.sql
-- ("0. Recruiting-center fix — restore private-schema access"), but that large
-- migration was never applied to the cutover project, so the grants never
-- landed. Extracted here as a standalone, idempotent migration so the fix
-- applies independently of the (still-deferred) Fleety rearchitecture.
--
-- NOTE: `private` is intentionally not in the PostgREST exposed-schemas list,
-- so these grants do NOT make it queryable over the API — they only let the
-- app roles execute the SECURITY-wrapper functions that legitimately call into
-- it (has_role, etc.). No new external surface.

GRANT USAGE ON SCHEMA private TO authenticated, anon, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated, anon, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA private
  GRANT EXECUTE ON FUNCTIONS TO authenticated, anon, service_role;
