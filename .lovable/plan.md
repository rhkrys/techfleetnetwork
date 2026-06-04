# Add historical Fillout signups to the Member World Map

## Data from the uploaded CSV

Parsed 1,457 rows, deduped by email → **75 countries, ~1,400 unique signups**. Top: US 541, Nigeria 362, Canada 92, UK 84, India 54, Kenya 34, Germany 20, Ghana 17, Spain 12, South Africa 10, Pakistan 10, …

## What exists today

- `public.profiles.country` is the live source of truth (members who sign up on the platform).
- RPC `get_member_country_distribution()` returns `{country, count}` from `profiles` only.
- `src/components/MemberWorldMap.tsx` consumes that RPC and shades countries on a d3-geo world map.
- No table currently stores external/historical signups.

## Approach

Keep live tracking (profiles) intact. Add a second, additive source for historical/external signups so the map shows an **all-time** number = `platform members + external signups`.

### 1. New table: `public.external_country_signups`

Columns: `country` (canonical name, unique with `source`), `unique_signups` (int), `source` (text, e.g. `fillout_community_signup_2026_06`), `notes`, timestamps. RLS: admin write, authenticated read. GRANTs included.

Designed to accept future imports (additional Fillout exports, partner lists, etc.) — not a one-off dump.

### 2. Seed migration

Insert all 75 country rows from the CSV with `source='fillout_community_signup_2026_06'`. Country names normalized to match `COUNTRY_NAME_TO_ID` keys (e.g. "United States of America" → "United States", "Republic of Korea (South Korea)" → "South Korea", "Syria, Syrian Arab Republic" → "Syria"). Unmapped names are kept verbatim and still counted in totals (will surface as "Not specified" only if the map can't resolve them — we'll log any).

### 3. RPC update: `get_member_country_distribution()`

Replace body with a UNION ALL + SUM:

```sql
SELECT country, SUM(cnt)::int AS cnt, SUM(platform_cnt)::int, SUM(external_cnt)::int
FROM (
  SELECT COALESCE(NULLIF(country,''),'Not specified') AS country,
         count(*)::int AS cnt, count(*)::int AS platform_cnt, 0 AS external_cnt
  FROM public.profiles GROUP BY 1
  UNION ALL
  SELECT country, unique_signups, 0, unique_signups
  FROM public.external_country_signups
) u
GROUP BY country
ORDER BY cnt DESC;
```

Return shape extended to `{country, count, platform_count, external_count}` — backward compatible (existing `count` field preserved).

### 4. UI update: `MemberWorldMap.tsx`

- Header stat changes from "N members" → **"N all-time signups"** with a sub-line "M platform members · K historical signups".
- Tooltip per country: `"{name}: {total} all-time ({platform} platform + {external} historical)"` when external > 0, else current copy.
- Legend unchanged otherwise.

### 5. Ongoing tracking

Nothing to wire up — `profiles.country` is already captured at signup (Register / Welcome Wizard / Profile setup). The external table is purely additive for historical data; future Fillout exports can be re-imported via an admin migration or a small `/admin/ingest` action (out of scope for this turn unless requested).

## Files / migrations

- **New migration**: create `external_country_signups` + GRANTs + RLS + seed 75 rows + replace `get_member_country_distribution()`.
- **Edit** `src/components/MemberWorldMap.tsx`: new fields in `CountryCount` type, updated header + tooltip copy.
- **BDD**: add scenarios `MAP-LOC-001..003` covering (a) external rows surface on map, (b) totals = platform+external, (c) ongoing profile inserts still increment counts.
- **Memory**: short note under `mem://features/network-stats-v4` pointing to the new additive source.

## Open question

Should I also dedupe CSV emails against existing `profiles.email` so members who later signed up on the platform aren't double-counted? Default: **no dedupe** (user said "all time number should include both"), but happy to add a `seeded_email_hashes` column + subtract overlap if you'd prefer accurate uniques.
