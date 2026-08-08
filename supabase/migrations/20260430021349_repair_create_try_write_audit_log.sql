-- REPAIR (audit H3): create public.try_write_audit_log so a fresh
-- `supabase db reset` can build the DB from source.
--
-- Root cause: try_write_audit_log was created directly on the Lovable-era
-- database and never captured in a migration, yet it is REVOKE'd at
-- 20260430021350, GRANT'd at 20260510/20260528, and PERFORM'd from several
-- later migrations. On a clean apply the very first reference (the 20260430
-- REVOKE) aborts because the function does not exist — which is why
-- `migration-smoke` / `db reset` has never passed and DR/cutover are blocked.
--
-- This file is intentionally timestamped 20260430021349 — one second BEFORE the
-- first reference (…021350) — so it applies first on a fresh reset. Body is the
-- EXACT current production definition (pg_get_functiondef), so it is a no-op on
-- prod: CREATE OR REPLACE re-defines the identical function. write_audit_log
-- (its callee) already exists from 20260315195132, so the dependency is met.
--
-- Prod apply note: because this file sorts earlier than already-applied
-- migrations, `supabase db push` needs `--include-all` to pick it up; the effect
-- there is only to (re)assert the already-present function.

CREATE OR REPLACE FUNCTION public.try_write_audit_log(
  p_event_type text,
  p_table_name text,
  p_record_id text,
  p_user_id uuid,
  p_changed_fields text[] DEFAULT NULL::text[],
  p_error_message text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  BEGIN
    PERFORM public.write_audit_log(
      p_event_type,
      p_table_name,
      p_record_id,
      p_user_id,
      p_changed_fields,
      p_error_message
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Audit write failed but main operation will continue: %', SQLERRM;
  END;
END;
$function$;

-- REPAIR (audit H3, cont.): 20260430021350 line 2 contains a copy-paste template
-- placeholder — `REVOKE EXECUTE ON FUNCTION public.your_audit_function_name()` —
-- for a function that was never meant to exist. On a fresh reset that REVOKE
-- aborts ("function does not exist"). We can't edit applied history, so create a
-- trivial stub here (before …021350) to let the REVOKE succeed; it is DROPped
-- immediately after in 20260430021351 so the final schema carries no junk.
CREATE OR REPLACE FUNCTION public.your_audit_function_name()
RETURNS void
LANGUAGE plpgsql
AS $function$ BEGIN END; $function$;
