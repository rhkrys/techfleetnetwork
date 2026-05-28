CREATE OR REPLACE FUNCTION public.enqueue_ugc_translation_jobs()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_reg     record;
  v_text    text;
  v_hash    text;
  v_locale  text;
  v_locales text[];
BEGIN
  FOR v_reg IN
    SELECT column_name, content_format, max_chars, is_pii, priority
    FROM public.i18n_content_registry
    WHERE table_name = TG_TABLE_NAME AND is_active = true
  LOOP
    IF v_reg.is_pii THEN CONTINUE; END IF;

    EXECUTE format('SELECT ($1).%I::text', v_reg.column_name) INTO v_text USING NEW;
    IF v_text IS NULL OR length(btrim(v_text)) = 0 THEN CONTINUE; END IF;
    IF v_reg.max_chars IS NOT NULL AND length(v_text) > v_reg.max_chars THEN CONTINUE; END IF;

    v_hash := encode(extensions.digest(v_text::bytea, 'sha256'::text), 'hex');

    IF TG_OP = 'UPDATE' THEN
      DECLARE v_old text; BEGIN
        EXECUTE format('SELECT ($1).%I::text', v_reg.column_name) INTO v_old USING OLD;
        IF v_old IS NOT DISTINCT FROM v_text THEN CONTINUE; END IF;
      END;
    END IF;

    v_locales := public.get_active_locales();
    IF v_locales IS NULL OR cardinality(v_locales) = 0 THEN CONTINUE; END IF;

    FOREACH v_locale IN ARRAY v_locales
    LOOP
      INSERT INTO public.ugc_translation_jobs
        (entity_table, entity_id, column_name, target_locale, source_hash, source_text, content_format, priority)
      VALUES
        (TG_TABLE_NAME, NEW.id, v_reg.column_name, v_locale, v_hash, v_text, v_reg.content_format,
         CASE WHEN v_reg.priority = 'hot' THEN 'realtime' ELSE 'batch' END)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$;