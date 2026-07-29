-- Restore the auth.users -> profiles creation trigger, and backfill the members
-- who signed up while it was missing.
--
-- Root cause (confirmed 2026-07-29 via live diagnostic):
--   auth.users            = 993 (newest today)
--   public.profiles       = 772 (newest 2026-06-22, the migration cutover)
--   missing_profiles      = 221 (oldest 2026-06-25)
--   triggers on auth.users= NONE
--   handle_new_user()     = present
-- During the Lovable -> owned-Supabase migration, the trigger ON auth.users was
-- not carried over (a public-schema dump doesn't include auth-schema triggers),
-- so handle_new_user() survived but was never invoked. Every signup since
-- 2026-06-25 created an auth user with no profiles row; User Admin (reads
-- profiles) froze at 772 / Jun 22.
--
-- Idempotent and safe to re-run.

-- 1. Re-attach the trigger to the (already-present) function.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Backfill profiles for every auth user that doesn't have one, mirroring
--    handle_new_user()'s field logic. NOT NULL text columns fall back to ''.
--    birth_year (nullable) is left NULL — users set it during onboarding.
INSERT INTO public.profiles (user_id, first_name, last_name, display_name, email)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'first_name', u.raw_user_meta_data->>'given_name', ''),
  COALESCE(u.raw_user_meta_data->>'last_name',  u.raw_user_meta_data->>'family_name', ''),
  COALESCE(
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    NULLIF(TRIM(
      COALESCE(u.raw_user_meta_data->>'first_name', u.raw_user_meta_data->>'given_name', '') || ' ' ||
      COALESCE(u.raw_user_meta_data->>'last_name',  u.raw_user_meta_data->>'family_name', '')
    ), ''),
    ''
  ),
  COALESCE(u.email, '')
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = u.id)
ON CONFLICT (user_id) DO NOTHING;
