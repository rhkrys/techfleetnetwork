-- DB grant / schema audit — find live-DB objects & grants that the migration
-- files do NOT reproduce, i.e. the class of gap that caused the 2026-06-25
-- "all applications blank" outage (missing USAGE on the `private` schema).
--
-- WHY THIS EXISTS: the `private` schema, its RLS-helper functions, and their
-- grants were created out-of-band on the old Lovable project (no `CREATE SCHEMA
-- private` exists in supabase/migrations/). A rebuild from migrations therefore
-- can't reproduce them — so RLS policies that call `private.*` helpers silently
-- 403 with "permission denied for schema private". This script surfaces every
-- object of that shape so we can capture the fixes as migrations instead of
-- discovering them one blank screen at a time.
--
-- HOW TO RUN: paste into the Supabase SQL Editor on the NEW project
-- (pzvqxdgoztbfikfuifix). All queries are READ-ONLY. Paste the results back to
-- Claude Code and it will produce the exact fix migrations. (Optionally run on
-- the OLD project too, while it still exists, as the "what should exist"
-- reference to diff against.)

-- 1) Non-system schemas and whether the API roles have USAGE.
--    A `false` here for a schema that RLS policies depend on = an outage waiting
--    to happen (this is what `private` looked like before the fix).
select n.nspname                                            as schema,
       has_schema_privilege('anon',          n.nspname, 'USAGE') as anon_usage,
       has_schema_privilege('authenticated', n.nspname, 'USAGE') as auth_usage
from pg_namespace n
where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
  and n.nspname not like 'pg\_temp\_%'
  and n.nspname not like 'pg\_toast\_temp\_%'
order by n.nspname;

-- 2) public tables with RLS ENABLED but `authenticated` lacking SELECT grant.
--    These 403 with "permission denied for table" (the broader form of the bug).
select n.nspname as schema,
       c.relname as table_name,
       has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select,
       has_table_privilege('anon',          c.oid, 'SELECT') as anon_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r'
  and c.relrowsecurity
  and n.nspname = 'public'
  and not has_table_privilege('authenticated', c.oid, 'SELECT')
order by c.relname;

-- 3) public tables with RLS ENABLED but ZERO policies → deny-all → the table
--    reads as silently empty (looks like "no data", not an error).
select n.nspname as schema, c.relname as table_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r'
  and c.relrowsecurity
  and n.nspname = 'public'
  and not exists (
    select 1 from pg_policies p
    where p.schemaname = n.nspname and p.tablename = c.relname
  )
order by c.relname;

-- 4) functions in non-public schemas (e.g. `private`) and whether the API roles
--    can EXECUTE them. RLS helpers live here; a `false` → 42501 → 403.
select n.nspname as schema,
       p.proname as function_name,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_execute,
       has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname not in ('public', 'pg_catalog', 'information_schema', 'extensions')
order by n.nspname, p.proname;
