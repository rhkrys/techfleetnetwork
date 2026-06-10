## Goal

Surface total unique people in the community grouped by **continent** (not country), combining live `profiles.country` signups with the historical `external_country_signups` import — same additive model as the existing world map.

## Approach

1. **Country→continent lookup (SQL)**
   Add an immutable SQL function `public.country_to_continent(text) returns text` with a hard-coded `CASE` mapping all ~250 ISO country names already seen in `profiles.country` + `external_country_signups.country` (currently 75 countries; covers the long tail too). Returns one of: `Africa`, `Asia`, `Europe`, `North America`, `South America`, `Oceania`, `Antarctica`, `Unknown`.

2. **RPC `get_member_continent_distribution()`**
   Wraps the existing additive query:
   ```sql
   SELECT country_to_continent(country) AS continent,
          SUM(platform_count)::int       AS platform_count,
          SUM(external_count)::int       AS external_count,
          SUM(platform_count + external_count)::int AS total_count
   FROM (
     SELECT country, COUNT(*)::int AS platform_count, 0 AS external_count
       FROM profiles WHERE country IS NOT NULL AND country <> '' GROUP BY country
     UNION ALL
     SELECT country, 0, unique_signups FROM external_country_signups
   ) s
   GROUP BY 1 ORDER BY total_count DESC;
   ```
   `SECURITY DEFINER`, `set search_path = public`, granted to `authenticated` + `service_role` (mirrors `get_member_country_distribution`).
   Follows the `#variable_conflict use_column` rule for `RETURNS TABLE`.

3. **UI surface** — add a small "By continent" card next to the existing Member World Map (on the page that already calls `get_member_country_distribution`). One row per continent: continent name + total. Matches existing card pattern (`tf-card`, iconless, ≥1rem text).

4. **One-off answer for "right now"**
   After the migration applies, I'll run the RPC and paste the totals back to you in the chat so you have the numbers for your stats deck immediately.

5. **BDD**: scenarios `MAP-LOC-004..005` covering RPC totals = country RPC totals (parity) and continent grouping correctness for 5 sample countries.

## What I will NOT touch

- The world map view itself, the existing `get_member_country_distribution` RPC, `external_country_signups` table, or the country import flow.

## Files

- `supabase/migrations/<ts>_continent_distribution.sql` — `country_to_continent()` + `get_member_continent_distribution()` + GRANTs.
- `src/components/dashboard/MemberContinentBreakdown.tsx` — new card.
- Wired into the existing world map page.
- BDD inserts.

No new tables. No deletes. Reversible (drop two functions).
