
-- One-shot backfill: materialize a profiles row for every auth.users id that
-- doesn't already have one. The in-code self-heal in
-- supabase/functions/_shared/freescout-admin.ts handles the live path going
-- forward; this migration repairs any pre-existing orphans (zero today, but
-- belt-and-suspenders for the helpdesk hot path).
--
-- Safe to re-run — `ON CONFLICT (user_id) DO NOTHING` no-ops on existing rows.

INSERT INTO public.profiles (user_id, email, first_name, last_name)
SELECT
  u.id,
  COALESCE(u.email, ''),
  COALESCE(NULLIF(u.raw_user_meta_data->>'first_name', ''),
           NULLIF(u.raw_user_meta_data->>'given_name', ''),
           split_part(COALESCE(u.email, ''), '@', 1),
           'Member'),
  COALESCE(NULLIF(u.raw_user_meta_data->>'last_name', ''),
           NULLIF(u.raw_user_meta_data->>'family_name', ''),
           '')
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.user_id = u.id
)
ON CONFLICT (user_id) DO NOTHING;
