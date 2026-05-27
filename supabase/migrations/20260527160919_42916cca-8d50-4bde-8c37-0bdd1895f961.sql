
-- Allow admins to backfill UGC for explicit locales (not only "active" ones in last 7d).
-- Also expose a small helper to enqueue a single entity for translation on demand.

CREATE OR REPLACE FUNCTION public.backfill_ugc_translations_for_locales(
  p_locales text[],
  p_table   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_reg   record;
  v_total bigint := 0;
  v_sql   text;
  v_rows  bigint;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  IF p_locales IS NULL OR cardinality(p_locales) = 0 THEN
    RAISE EXCEPTION 'p_locales required';
  END IF;
  IF cardinality(p_locales) > 50 THEN
    RAISE EXCEPTION 'max 50 locales per call';
  END IF;

  FOR v_reg IN
    SELECT table_name, column_name, content_format, max_chars
    FROM i18n_content_registry
    WHERE is_active = true
      AND (p_table IS NULL OR table_name = p_table)
      AND is_pii = false
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_reg.table_name
        AND column_name = v_reg.column_name
    ) THEN CONTINUE; END IF;

    v_sql := format(
      $f$
      WITH src AS (
        SELECT id::uuid AS entity_id,
               (%I)::text AS source_text,
               encode(extensions.digest((%I)::text, 'sha256'), 'hex') AS source_hash
        FROM public.%I
        WHERE %I IS NOT NULL AND length(btrim((%I)::text)) > 0 %s
      ),
      lc AS (SELECT unnest($1::text[]) AS target_locale)
      INSERT INTO public.ugc_translation_jobs
        (entity_table, entity_id, column_name, target_locale, source_hash, source_text, content_format, priority)
      SELECT %L, src.entity_id, %L, lc.target_locale, src.source_hash, src.source_text, %L, 'backfill'
      FROM src CROSS JOIN lc
      LEFT JOIN public.ugc_translations t
        ON t.entity_table = %L AND t.entity_id = src.entity_id
       AND t.column_name = %L AND t.target_locale = lc.target_locale
       AND t.source_hash = src.source_hash AND t.status IN ('qa_passed','approved')
      WHERE t.id IS NULL
      ON CONFLICT DO NOTHING
      $f$,
      v_reg.column_name, v_reg.column_name, v_reg.table_name, v_reg.column_name, v_reg.column_name,
      CASE WHEN v_reg.max_chars IS NOT NULL
           THEN format('AND length((%I)::text) <= %s', v_reg.column_name, v_reg.max_chars)
           ELSE '' END,
      v_reg.table_name, v_reg.column_name, v_reg.content_format,
      v_reg.table_name, v_reg.column_name
    );

    EXECUTE v_sql USING p_locales;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_total := v_total + v_rows;
  END LOOP;

  RETURN jsonb_build_object('enqueued', v_total, 'locales', p_locales);
END
$function$;

REVOKE ALL ON FUNCTION public.backfill_ugc_translations_for_locales(text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backfill_ugc_translations_for_locales(text[], text) TO authenticated, service_role;
