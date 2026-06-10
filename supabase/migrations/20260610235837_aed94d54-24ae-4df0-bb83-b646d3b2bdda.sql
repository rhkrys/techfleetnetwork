
CREATE OR REPLACE FUNCTION public.country_to_continent(p_country text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(trim(p_country))
    WHEN 'algeria' THEN 'Africa' WHEN 'angola' THEN 'Africa' WHEN 'benin' THEN 'Africa'
    WHEN 'botswana' THEN 'Africa' WHEN 'burkina faso' THEN 'Africa' WHEN 'burundi' THEN 'Africa'
    WHEN 'cabo verde' THEN 'Africa' WHEN 'cape verde' THEN 'Africa' WHEN 'cameroon' THEN 'Africa'
    WHEN 'central african republic' THEN 'Africa' WHEN 'chad' THEN 'Africa' WHEN 'comoros' THEN 'Africa'
    WHEN 'congo' THEN 'Africa' WHEN 'republic of the congo' THEN 'Africa'
    WHEN 'democratic republic of the congo' THEN 'Africa' WHEN 'dr congo' THEN 'Africa'
    WHEN 'cote d''ivoire' THEN 'Africa' WHEN 'ivory coast' THEN 'Africa' WHEN 'djibouti' THEN 'Africa'
    WHEN 'egypt' THEN 'Africa' WHEN 'equatorial guinea' THEN 'Africa' WHEN 'eritrea' THEN 'Africa'
    WHEN 'eswatini' THEN 'Africa' WHEN 'swaziland' THEN 'Africa' WHEN 'ethiopia' THEN 'Africa'
    WHEN 'gabon' THEN 'Africa' WHEN 'gambia' THEN 'Africa' WHEN 'ghana' THEN 'Africa'
    WHEN 'guinea' THEN 'Africa' WHEN 'guinea-bissau' THEN 'Africa' WHEN 'kenya' THEN 'Africa'
    WHEN 'lesotho' THEN 'Africa' WHEN 'liberia' THEN 'Africa' WHEN 'libya' THEN 'Africa'
    WHEN 'madagascar' THEN 'Africa' WHEN 'malawi' THEN 'Africa' WHEN 'mali' THEN 'Africa'
    WHEN 'mauritania' THEN 'Africa' WHEN 'mauritius' THEN 'Africa' WHEN 'morocco' THEN 'Africa'
    WHEN 'mozambique' THEN 'Africa' WHEN 'namibia' THEN 'Africa' WHEN 'niger' THEN 'Africa'
    WHEN 'nigeria' THEN 'Africa' WHEN 'rwanda' THEN 'Africa' WHEN 'sao tome and principe' THEN 'Africa'
    WHEN 'senegal' THEN 'Africa' WHEN 'seychelles' THEN 'Africa' WHEN 'sierra leone' THEN 'Africa'
    WHEN 'somalia' THEN 'Africa' WHEN 'south africa' THEN 'Africa' WHEN 'south sudan' THEN 'Africa'
    WHEN 'sudan' THEN 'Africa' WHEN 'tanzania' THEN 'Africa' WHEN 'togo' THEN 'Africa'
    WHEN 'tunisia' THEN 'Africa' WHEN 'uganda' THEN 'Africa' WHEN 'zambia' THEN 'Africa'
    WHEN 'zimbabwe' THEN 'Africa'
    WHEN 'afghanistan' THEN 'Asia' WHEN 'armenia' THEN 'Asia' WHEN 'azerbaijan' THEN 'Asia'
    WHEN 'bahrain' THEN 'Asia' WHEN 'bangladesh' THEN 'Asia' WHEN 'bhutan' THEN 'Asia'
    WHEN 'brunei' THEN 'Asia' WHEN 'cambodia' THEN 'Asia' WHEN 'china' THEN 'Asia'
    WHEN 'cyprus' THEN 'Asia' WHEN 'georgia' THEN 'Asia' WHEN 'hong kong' THEN 'Asia'
    WHEN 'india' THEN 'Asia' WHEN 'indonesia' THEN 'Asia' WHEN 'iran' THEN 'Asia'
    WHEN 'iraq' THEN 'Asia' WHEN 'israel' THEN 'Asia' WHEN 'japan' THEN 'Asia'
    WHEN 'jordan' THEN 'Asia' WHEN 'kazakhstan' THEN 'Asia' WHEN 'kuwait' THEN 'Asia'
    WHEN 'kyrgyzstan' THEN 'Asia' WHEN 'laos' THEN 'Asia' WHEN 'lebanon' THEN 'Asia'
    WHEN 'macau' THEN 'Asia' WHEN 'malaysia' THEN 'Asia' WHEN 'maldives' THEN 'Asia'
    WHEN 'mongolia' THEN 'Asia' WHEN 'myanmar' THEN 'Asia' WHEN 'burma' THEN 'Asia'
    WHEN 'nepal' THEN 'Asia' WHEN 'north korea' THEN 'Asia' WHEN 'oman' THEN 'Asia'
    WHEN 'pakistan' THEN 'Asia' WHEN 'palestine' THEN 'Asia' WHEN 'philippines' THEN 'Asia'
    WHEN 'qatar' THEN 'Asia' WHEN 'saudi arabia' THEN 'Asia' WHEN 'singapore' THEN 'Asia'
    WHEN 'south korea' THEN 'Asia' WHEN 'korea' THEN 'Asia' WHEN 'sri lanka' THEN 'Asia'
    WHEN 'syria' THEN 'Asia' WHEN 'taiwan' THEN 'Asia' WHEN 'tajikistan' THEN 'Asia'
    WHEN 'thailand' THEN 'Asia' WHEN 'timor-leste' THEN 'Asia' WHEN 'east timor' THEN 'Asia'
    WHEN 'turkey' THEN 'Asia' WHEN 'turkmenistan' THEN 'Asia' WHEN 'united arab emirates' THEN 'Asia'
    WHEN 'uae' THEN 'Asia' WHEN 'uzbekistan' THEN 'Asia' WHEN 'vietnam' THEN 'Asia'
    WHEN 'yemen' THEN 'Asia'
    WHEN 'albania' THEN 'Europe' WHEN 'andorra' THEN 'Europe' WHEN 'austria' THEN 'Europe'
    WHEN 'belarus' THEN 'Europe' WHEN 'belgium' THEN 'Europe' WHEN 'bosnia and herzegovina' THEN 'Europe'
    WHEN 'bulgaria' THEN 'Europe' WHEN 'croatia' THEN 'Europe' WHEN 'czech republic' THEN 'Europe'
    WHEN 'czechia' THEN 'Europe' WHEN 'denmark' THEN 'Europe' WHEN 'estonia' THEN 'Europe'
    WHEN 'finland' THEN 'Europe' WHEN 'france' THEN 'Europe' WHEN 'germany' THEN 'Europe'
    WHEN 'greece' THEN 'Europe' WHEN 'hungary' THEN 'Europe' WHEN 'iceland' THEN 'Europe'
    WHEN 'ireland' THEN 'Europe' WHEN 'italy' THEN 'Europe' WHEN 'kosovo' THEN 'Europe'
    WHEN 'latvia' THEN 'Europe' WHEN 'liechtenstein' THEN 'Europe' WHEN 'lithuania' THEN 'Europe'
    WHEN 'luxembourg' THEN 'Europe' WHEN 'malta' THEN 'Europe' WHEN 'moldova' THEN 'Europe'
    WHEN 'monaco' THEN 'Europe' WHEN 'montenegro' THEN 'Europe' WHEN 'netherlands' THEN 'Europe'
    WHEN 'north macedonia' THEN 'Europe' WHEN 'macedonia' THEN 'Europe' WHEN 'norway' THEN 'Europe'
    WHEN 'poland' THEN 'Europe' WHEN 'portugal' THEN 'Europe' WHEN 'romania' THEN 'Europe'
    WHEN 'russia' THEN 'Europe' WHEN 'san marino' THEN 'Europe' WHEN 'serbia' THEN 'Europe'
    WHEN 'slovakia' THEN 'Europe' WHEN 'slovenia' THEN 'Europe' WHEN 'spain' THEN 'Europe'
    WHEN 'sweden' THEN 'Europe' WHEN 'switzerland' THEN 'Europe' WHEN 'ukraine' THEN 'Europe'
    WHEN 'united kingdom' THEN 'Europe' WHEN 'uk' THEN 'Europe' WHEN 'great britain' THEN 'Europe'
    WHEN 'england' THEN 'Europe' WHEN 'scotland' THEN 'Europe' WHEN 'wales' THEN 'Europe'
    WHEN 'northern ireland' THEN 'Europe' WHEN 'vatican city' THEN 'Europe'
    WHEN 'antigua and barbuda' THEN 'North America' WHEN 'bahamas' THEN 'North America'
    WHEN 'barbados' THEN 'North America' WHEN 'belize' THEN 'North America' WHEN 'canada' THEN 'North America'
    WHEN 'costa rica' THEN 'North America' WHEN 'cuba' THEN 'North America' WHEN 'dominica' THEN 'North America'
    WHEN 'dominican republic' THEN 'North America' WHEN 'el salvador' THEN 'North America'
    WHEN 'grenada' THEN 'North America' WHEN 'guatemala' THEN 'North America' WHEN 'haiti' THEN 'North America'
    WHEN 'honduras' THEN 'North America' WHEN 'jamaica' THEN 'North America' WHEN 'mexico' THEN 'North America'
    WHEN 'nicaragua' THEN 'North America' WHEN 'panama' THEN 'North America'
    WHEN 'saint kitts and nevis' THEN 'North America' WHEN 'saint lucia' THEN 'North America'
    WHEN 'saint vincent and the grenadines' THEN 'North America' WHEN 'trinidad and tobago' THEN 'North America'
    WHEN 'united states' THEN 'North America' WHEN 'usa' THEN 'North America' WHEN 'us' THEN 'North America'
    WHEN 'puerto rico' THEN 'North America'
    WHEN 'argentina' THEN 'South America' WHEN 'bolivia' THEN 'South America' WHEN 'brazil' THEN 'South America'
    WHEN 'chile' THEN 'South America' WHEN 'colombia' THEN 'South America' WHEN 'ecuador' THEN 'South America'
    WHEN 'guyana' THEN 'South America' WHEN 'paraguay' THEN 'South America' WHEN 'peru' THEN 'South America'
    WHEN 'suriname' THEN 'South America' WHEN 'uruguay' THEN 'South America'
    WHEN 'venezuela' THEN 'South America' WHEN 'french guiana' THEN 'South America'
    WHEN 'australia' THEN 'Oceania' WHEN 'fiji' THEN 'Oceania' WHEN 'kiribati' THEN 'Oceania'
    WHEN 'marshall islands' THEN 'Oceania' WHEN 'micronesia' THEN 'Oceania' WHEN 'nauru' THEN 'Oceania'
    WHEN 'new zealand' THEN 'Oceania' WHEN 'palau' THEN 'Oceania' WHEN 'papua new guinea' THEN 'Oceania'
    WHEN 'samoa' THEN 'Oceania' WHEN 'solomon islands' THEN 'Oceania' WHEN 'tonga' THEN 'Oceania'
    WHEN 'tuvalu' THEN 'Oceania' WHEN 'vanuatu' THEN 'Oceania'
    WHEN 'antarctica' THEN 'Antarctica'
    ELSE 'Unknown'
  END;
$$;

GRANT EXECUTE ON FUNCTION public.country_to_continent(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_member_continent_distribution()
RETURNS TABLE (
  continent text,
  platform_count integer,
  external_count integer,
  total_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT
    public.country_to_continent(s.country)        AS continent,
    SUM(s.platform_count)::int                    AS platform_count,
    SUM(s.external_count)::int                    AS external_count,
    SUM(s.platform_count + s.external_count)::int AS total_count
  FROM (
    SELECT p.country AS country, COUNT(*)::int AS platform_count, 0 AS external_count
      FROM public.profiles p
      WHERE p.country IS NOT NULL AND p.country <> ''
      GROUP BY p.country
    UNION ALL
    SELECT e.country AS country, 0 AS platform_count, e.unique_signups AS external_count
      FROM public.external_country_signups e
  ) s
  GROUP BY public.country_to_continent(s.country)
  ORDER BY 4 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_member_continent_distribution() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_continent_distribution() TO authenticated, service_role;
