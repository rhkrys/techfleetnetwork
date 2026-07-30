-- admin_list_users(): account-driven roster for the User Admin screen.
--
-- Why: User Admin previously read public.profiles directly, so any account
-- without a profile row was invisible (see the 2026-06 trigger-loss incident:
-- 221 members hidden). This function is the source of truth = auth.users LEFT
-- JOIN profiles, so every account appears whether or not its profile exists or
-- is complete. Admin-only, SECURITY DEFINER (must read the auth schema).
--
-- Security:
--   * Hard admin gate via has_role() — raises if the caller isn't an admin.
--   * Never returns secrets: no encrypted_password, no auth confirmation/
--     recovery tokens, no profiles.guardian_consent_token (stripped from the
--     full-profile jsonb).

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
    COALESCE(
      (SELECT array_agg(DISTINCT jsonb_array_elements_text(
        COALESCE(u.raw_app_meta_data->'providers', '[]'::jsonb))))
    , ARRAY[]::text[]),
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
    -- Full profile, minus the one security-sensitive column.
    (to_jsonb(p) - 'guardian_consent_token')
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  WHERE u.deleted_at IS NULL
  ORDER BY u.created_at DESC;
END;
$$;

-- Callable only by authenticated users (the body still enforces admin); never anon.
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
