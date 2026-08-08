-- Restore baseline privileges on the `private` schema for the API roles.
--
-- Root cause (production incident 2026-06-25): row-level-security policies on
-- many tables call helper functions that live in the `private` schema (e.g.
-- role checks). For those policies to evaluate, the `authenticated`/`anon`
-- roles need USAGE on that schema and EXECUTE on its functions. On the rebuilt
-- (post-Lovable) project that grant was missing, so every RLS check that
-- touched a `private.*` helper failed with:
--     42501  permission denied for schema private   (surfaced as HTTP 403)
-- The recruiting center, project applications, admin_banners, etc. all rendered
-- blank while the data was fully intact. Service-role paths (the Supabase Table
-- Editor and edge functions) were unaffected because they bypass these checks —
-- which is why the data was visible in the dashboard but not in the app.
--
-- This was applied to the live DB as an emergency fix on 2026-06-25; it is
-- captured here so it survives any future rebuild from migrations. GRANT and
-- ALTER DEFAULT PRIVILEGES are idempotent, so re-applying is a no-op. RLS still
-- enforces row-level access — this only restores the ability to *run* the
-- policy checks, not direct access to private objects (the `private` schema is
-- not exposed through PostgREST).
grant usage on schema private to anon, authenticated;
grant execute on all functions in schema private to anon, authenticated;
alter default privileges in schema private
  grant execute on functions to anon, authenticated;
