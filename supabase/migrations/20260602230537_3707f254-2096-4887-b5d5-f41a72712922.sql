
-- announcement_actions: powers tri-state announcement cards
CREATE TABLE IF NOT EXISTS public.announcement_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  action          TEXT NOT NULL CHECK (action IN ('clicked_cta','dismissed','archived')),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (user_id, announcement_id, action)
);
CREATE INDEX IF NOT EXISTS idx_announcement_actions_user
  ON public.announcement_actions(user_id, occurred_at DESC);
GRANT SELECT, INSERT ON public.announcement_actions TO authenticated;
GRANT ALL ON public.announcement_actions TO service_role;
ALTER TABLE public.announcement_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users insert own announcement actions"
  ON public.announcement_actions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users view own announcement actions"
  ON public.announcement_actions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "admins view all announcement actions"
  ON public.announcement_actions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- v_profile_readiness: single source of truth for completeness meter + nudges
CREATE OR REPLACE VIEW public.v_profile_readiness
WITH (security_invoker = true) AS
SELECT
  p.id AS user_id,
  -- 8 weighted fields; each present = ~12.5 points (cap 100)
  LEAST(100, (
      (CASE WHEN COALESCE(NULLIF(TRIM(p.first_name),''), NULL) IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(NULLIF(TRIM(p.last_name),''),  NULL) IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(NULLIF(TRIM(p.display_name),''),NULL) IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(NULLIF(TRIM(p.country),''),    NULL) IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(NULLIF(TRIM(p.timezone),''),   NULL) IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(NULLIF(TRIM(p.avatar_url),''), NULL) IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(NULLIF(TRIM(p.bio),''),        NULL) IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(NULLIF(TRIM(p.discord_username),''),NULL) IS NOT NULL THEN 1 ELSE 0 END)
    ) * 12.5)::numeric AS score,
  ARRAY_REMOVE(ARRAY[
      CASE WHEN COALESCE(NULLIF(TRIM(p.first_name),''),NULL)        IS NULL THEN 'first_name'       END,
      CASE WHEN COALESCE(NULLIF(TRIM(p.last_name),''),NULL)         IS NULL THEN 'last_name'        END,
      CASE WHEN COALESCE(NULLIF(TRIM(p.display_name),''),NULL)      IS NULL THEN 'display_name'     END,
      CASE WHEN COALESCE(NULLIF(TRIM(p.country),''),NULL)           IS NULL THEN 'country'          END,
      CASE WHEN COALESCE(NULLIF(TRIM(p.timezone),''),NULL)          IS NULL THEN 'timezone'         END,
      CASE WHEN COALESCE(NULLIF(TRIM(p.avatar_url),''),NULL)        IS NULL THEN 'avatar_url'       END,
      CASE WHEN COALESCE(NULLIF(TRIM(p.bio),''),NULL)               IS NULL THEN 'bio'              END,
      CASE WHEN COALESCE(NULLIF(TRIM(p.discord_username),''),NULL)  IS NULL THEN 'discord_username' END
    ], NULL) AS missing_fields
FROM public.profiles p;

GRANT SELECT ON public.v_profile_readiness TO authenticated;
GRANT ALL    ON public.v_profile_readiness TO service_role;
