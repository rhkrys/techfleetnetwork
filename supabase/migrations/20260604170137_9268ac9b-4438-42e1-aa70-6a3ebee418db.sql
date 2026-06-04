
-- 1. Table for additive external/historical signup counts by country
CREATE TABLE IF NOT EXISTS public.external_country_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country text NOT NULL,
  unique_signups integer NOT NULL CHECK (unique_signups >= 0),
  source text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country, source)
);

GRANT SELECT ON public.external_country_signups TO authenticated;
GRANT ALL ON public.external_country_signups TO service_role;

ALTER TABLE public.external_country_signups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read external signups"
  ON public.external_country_signups FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage external signups"
  ON public.external_country_signups FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_external_country_signups_updated_at
  BEFORE UPDATE ON public.external_country_signups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Seed Fillout community signup form export (deduped by email, normalized to canonical names)
INSERT INTO public.external_country_signups (country, unique_signups, source, notes) VALUES
  ('United States', 541, 'fillout_community_signup_2026_06', 'Historical Fillout signups'),
  ('Nigeria', 362, 'fillout_community_signup_2026_06', NULL),
  ('Canada', 92, 'fillout_community_signup_2026_06', NULL),
  ('United Kingdom', 84, 'fillout_community_signup_2026_06', NULL),
  ('India', 54, 'fillout_community_signup_2026_06', NULL),
  ('Kenya', 34, 'fillout_community_signup_2026_06', NULL),
  ('Germany', 20, 'fillout_community_signup_2026_06', NULL),
  ('Ghana', 17, 'fillout_community_signup_2026_06', NULL),
  ('Spain', 12, 'fillout_community_signup_2026_06', NULL),
  ('South Africa', 10, 'fillout_community_signup_2026_06', NULL),
  ('Pakistan', 10, 'fillout_community_signup_2026_06', NULL),
  ('Netherlands', 6, 'fillout_community_signup_2026_06', NULL),
  ('Egypt', 6, 'fillout_community_signup_2026_06', NULL),
  ('Zimbabwe', 5, 'fillout_community_signup_2026_06', NULL),
  ('Vietnam', 5, 'fillout_community_signup_2026_06', NULL),
  ('Brazil', 5, 'fillout_community_signup_2026_06', NULL),
  ('Uganda', 5, 'fillout_community_signup_2026_06', NULL),
  ('China', 5, 'fillout_community_signup_2026_06', 'Includes "People''s Republic of China" responses'),
  ('Bangladesh', 4, 'fillout_community_signup_2026_06', NULL),
  ('Indonesia', 4, 'fillout_community_signup_2026_06', NULL),
  ('South Korea', 4, 'fillout_community_signup_2026_06', NULL),
  ('Malawi', 4, 'fillout_community_signup_2026_06', NULL),
  ('Ireland', 4, 'fillout_community_signup_2026_06', NULL),
  ('Cameroon', 4, 'fillout_community_signup_2026_06', NULL),
  ('Philippines', 3, 'fillout_community_signup_2026_06', NULL),
  ('Sweden', 3, 'fillout_community_signup_2026_06', NULL),
  ('Zambia', 3, 'fillout_community_signup_2026_06', NULL),
  ('Italy', 3, 'fillout_community_signup_2026_06', NULL),
  ('Australia', 3, 'fillout_community_signup_2026_06', NULL),
  ('France', 3, 'fillout_community_signup_2026_06', NULL),
  ('Portugal', 3, 'fillout_community_signup_2026_06', NULL),
  ('Ethiopia', 3, 'fillout_community_signup_2026_06', NULL),
  ('Thailand', 3, 'fillout_community_signup_2026_06', NULL),
  ('Tunisia', 2, 'fillout_community_signup_2026_06', NULL),
  ('Finland', 2, 'fillout_community_signup_2026_06', NULL),
  ('Russia', 2, 'fillout_community_signup_2026_06', NULL),
  ('Iran', 2, 'fillout_community_signup_2026_06', NULL),
  ('Taiwan', 2, 'fillout_community_signup_2026_06', NULL),
  ('New Zealand', 2, 'fillout_community_signup_2026_06', NULL),
  ('Democratic Republic of the Congo', 2, 'fillout_community_signup_2026_06', NULL),
  ('Liberia', 2, 'fillout_community_signup_2026_06', NULL),
  ('Argentina', 2, 'fillout_community_signup_2026_06', NULL),
  ('Colombia', 2, 'fillout_community_signup_2026_06', NULL),
  ('Singapore', 2, 'fillout_community_signup_2026_06', NULL),
  ('Belgium', 2, 'fillout_community_signup_2026_06', NULL),
  ('Chile', 1, 'fillout_community_signup_2026_06', NULL),
  ('Romania', 1, 'fillout_community_signup_2026_06', NULL),
  ('Switzerland', 1, 'fillout_community_signup_2026_06', NULL),
  ('Bahamas', 1, 'fillout_community_signup_2026_06', NULL),
  ('Sierra Leone', 1, 'fillout_community_signup_2026_06', NULL),
  ('Croatia', 1, 'fillout_community_signup_2026_06', NULL),
  ('Botswana', 1, 'fillout_community_signup_2026_06', NULL),
  ('Venezuela', 1, 'fillout_community_signup_2026_06', NULL),
  ('Japan', 1, 'fillout_community_signup_2026_06', NULL),
  ('Benin', 1, 'fillout_community_signup_2026_06', NULL),
  ('Mexico', 1, 'fillout_community_signup_2026_06', NULL),
  ('Bahrain', 1, 'fillout_community_signup_2026_06', NULL),
  ('Guinea', 1, 'fillout_community_signup_2026_06', NULL),
  ('Serbia', 1, 'fillout_community_signup_2026_06', NULL),
  ('United Arab Emirates', 1, 'fillout_community_signup_2026_06', NULL),
  ('Morocco', 1, 'fillout_community_signup_2026_06', NULL),
  ('Czech Republic', 1, 'fillout_community_signup_2026_06', NULL),
  ('Poland', 1, 'fillout_community_signup_2026_06', NULL),
  ('Libya', 1, 'fillout_community_signup_2026_06', NULL),
  ('Turkmenistan', 1, 'fillout_community_signup_2026_06', NULL),
  ('Rwanda', 1, 'fillout_community_signup_2026_06', NULL),
  ('Turkey', 1, 'fillout_community_signup_2026_06', NULL),
  ('Ukraine', 1, 'fillout_community_signup_2026_06', NULL),
  ('Malaysia', 1, 'fillout_community_signup_2026_06', NULL),
  ('Luxembourg', 1, 'fillout_community_signup_2026_06', NULL),
  ('Namibia', 1, 'fillout_community_signup_2026_06', NULL),
  ('Syria', 1, 'fillout_community_signup_2026_06', NULL),
  ('Suriname', 1, 'fillout_community_signup_2026_06', NULL),
  ('Eswatini', 1, 'fillout_community_signup_2026_06', NULL)
ON CONFLICT (country, source) DO UPDATE SET unique_signups = EXCLUDED.unique_signups, updated_at = now();

-- 3. Replace RPC to include external signups additively
CREATE OR REPLACE FUNCTION public.get_member_country_distribution()
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT COALESCE(
    json_agg(json_build_object(
      'country', country,
      'count', cnt,
      'platform_count', platform_cnt,
      'external_count', external_cnt
    ) ORDER BY cnt DESC),
    '[]'::json
  )
  FROM (
    SELECT
      country,
      SUM(platform_cnt)::int + SUM(external_cnt)::int AS cnt,
      SUM(platform_cnt)::int AS platform_cnt,
      SUM(external_cnt)::int AS external_cnt
    FROM (
      SELECT COALESCE(NULLIF(country, ''), 'Not specified') AS country,
             count(*)::int AS platform_cnt,
             0 AS external_cnt
      FROM public.profiles
      GROUP BY 1
      UNION ALL
      SELECT country, 0, unique_signups
      FROM public.external_country_signups
    ) u
    GROUP BY country
  ) sub;
$function$;
