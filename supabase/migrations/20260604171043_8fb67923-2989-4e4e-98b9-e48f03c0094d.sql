DO $migration$
DECLARE
  r RECORD;
  v_def TEXT;
  v_new TEXT;
  v_patched INT := 0;
  v_skipped INT := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
      AND pg_get_function_result(p.oid) LIKE 'TABLE(%'
      AND pg_get_functiondef(p.oid) NOT ILIKE '%variable_conflict%'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    -- pg_get_functiondef always emits the body with $function$ delimiters.
    v_new := regexp_replace(
      v_def,
      E'AS \\$function\\$\\s*\\n',
      E'AS $function$\n#variable_conflict use_column\n',
      ''
    );
    IF v_new = v_def THEN
      v_skipped := v_skipped + 1;
      RAISE NOTICE 'skipped (no body marker matched): %', r.proname;
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE v_new;
      v_patched := v_patched + 1;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      RAISE NOTICE 'skipped (replay failed): % — %', r.proname, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'plpgsql_variable_conflict_backfill: patched=%, skipped=%', v_patched, v_skipped;
END
$migration$;