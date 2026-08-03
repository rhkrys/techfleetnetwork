-- Fix admin_list_users(): the auth_providers subquery nested a set-returning
-- function (jsonb_array_elements_text) INSIDE array_agg(), which Postgres rejects
-- ("set-returning functions are not allowed in aggregate function arguments",
-- SQLSTATE 0A000). PostgREST surfaced this as an HTTP 400 on every call, so the
-- User Admin roster returned 0 users. The set-returning function must live in a
-- FROM clause; array_agg then aggregates the expanded rows.
--
-- This corrects the definition from 20260729210000_admin_list_users_rpc.sql
-- (already hotfixed on the live project via CREATE OR REPLACE). Idempotent.

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  user_id              uuid,
  email                text,
  email_confirmed      boolean,
  account_created_at   timestamptz,
  last_sign_in_at      timestamptz,
  phone                text,
  is_banned            boolean,
  auth_providers       text[],
  has_profile          boolean,
  profile_completed    boolean,
  first_name           text,
  last_name            text,
  display_name         text,
  discord_username     text,
  country              text,
  timezone             text,
  membership_tier      text,
  is_founding_member   boolean,
  is_test_account      boolean,
  onboarded_at         timestamptz,
  profile_created_at   timestamptz,
  profile              jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin_list_users: admin role required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email::text,
    (u.email_confirmed_at IS NOT NULL),
    u.created_at,
    u.last_sign_in_at,
    u.phone::text,
    (u.banned_until IS NOT NULL AND u.banned_until > now()),
    -- FIX: expand the providers array in a FROM clause, then aggregate. Nesting
    -- the set-returning function directly inside the aggregate (the old form) is
    -- rejected by Postgres.
    COALESCE(
      (SELECT array_agg(DISTINCT prov)
         FROM jsonb_array_elements_text(
           COALESCE(u.raw_app_meta_data->'providers', '[]'::jsonb)
         ) AS prov),
      ARRAY[]::text[]),
    (p.user_id IS NOT NULL),
    COALESCE(p.profile_completed, false),
    p.first_name,
    p.last_name,
    p.display_name,
    p.discord_username,
    p.country,
    p.timezone,
    p.membership_tier::text,
    p.is_founding_member,
    COALESCE(p.is_test_account, false),
    p.onboarded_at,
    p.created_at,
    (to_jsonb(p) - 'guardian_consent_token')
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  WHERE u.deleted_at IS NULL
  ORDER BY u.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
