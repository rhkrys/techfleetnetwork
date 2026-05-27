
-- ---------------------------------------------------------------------
-- Backfill RPC: enqueue all existing UGC rows for translation
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.backfill_ugc_translations(p_table text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_reg     record;
  v_locales text[];
  v_total   bigint := 0;
  v_sql     text;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  v_locales := get_active_locales();
  IF v_locales IS NULL OR cardinality(v_locales) = 0 THEN
    RETURN jsonb_build_object('enqueued', 0, 'reason', 'no_active_locales');
  END IF;

  FOR v_reg IN
    SELECT table_name, column_name, content_format, max_chars, priority, is_pii
    FROM i18n_content_registry
    WHERE is_active = true
      AND (p_table IS NULL OR table_name = p_table)
      AND is_pii = false
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = v_reg.table_name AND column_name = v_reg.column_name
    ) THEN CONTINUE; END IF;

    v_sql := format(
      $f$
      WITH src AS (
        SELECT id::uuid AS entity_id,
               (%I)::text AS source_text,
               encode(extensions.digest((%I)::text, 'sha256'), 'hex') AS source_hash
        FROM public.%I
        WHERE %I IS NOT NULL AND length(btrim((%I)::text)) > 0
          %s
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
      CASE WHEN v_reg.max_chars IS NOT NULL THEN format('AND length((%I)::text) <= %s', v_reg.column_name, v_reg.max_chars) ELSE '' END,
      v_reg.table_name, v_reg.column_name, v_reg.content_format,
      v_reg.table_name, v_reg.column_name
    );
    EXECUTE v_sql USING v_locales;
    GET DIAGNOSTICS v_total = ROW_COUNT;
  END LOOP;

  RETURN jsonb_build_object('enqueued', v_total, 'locales', v_locales);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.backfill_ugc_translations(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backfill_ugc_translations(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- Coverage audit RPC + cron
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_i18n_coverage()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_locale text;
  v_static_total int;
  v_inserted int := 0;
BEGIN
  SELECT count(*) INTO v_static_total FROM i18n_strings WHERE is_active = true;

  FOR v_locale IN
    SELECT DISTINCT unnest(get_active_locales())
  LOOP
    INSERT INTO i18n_coverage_audit (
      locale, total_strings, translated, qa_passed, qa_failed, missing, coverage_pct,
      ugc_total, ugc_translated, ugc_coverage_pct
    )
    SELECT
      v_locale,
      v_static_total,
      (SELECT count(*) FROM i18n_translations WHERE locale = v_locale),
      (SELECT count(*) FROM i18n_translations WHERE locale = v_locale AND status IN ('qa_passed','approved')),
      (SELECT count(*) FROM i18n_translations WHERE locale = v_locale AND status = 'qa_failed'),
      GREATEST(v_static_total - (SELECT count(*) FROM i18n_translations WHERE locale = v_locale AND status IN ('qa_passed','approved')), 0),
      CASE WHEN v_static_total = 0 THEN 100
        ELSE round(100.0 * (SELECT count(*) FROM i18n_translations WHERE locale = v_locale AND status IN ('qa_passed','approved')) / v_static_total, 2) END,
      (SELECT count(*) FROM ugc_translations WHERE target_locale = v_locale),
      (SELECT count(*) FROM ugc_translations WHERE target_locale = v_locale AND status IN ('qa_passed','approved')),
      CASE WHEN (SELECT count(*) FROM ugc_translations WHERE target_locale = v_locale) = 0 THEN 100
        ELSE round(100.0 * (SELECT count(*) FROM ugc_translations WHERE target_locale = v_locale AND status IN ('qa_passed','approved'))
          / NULLIF((SELECT count(*) FROM ugc_translations WHERE target_locale = v_locale), 0), 2) END;
    v_inserted := v_inserted + 1;
  END LOOP;

  DELETE FROM i18n_coverage_audit WHERE audited_at < now() - interval '30 days';
  RETURN jsonb_build_object('locales_audited', v_inserted);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.audit_i18n_coverage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_i18n_coverage() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- Admin dashboard view: latest coverage per locale + queue depth + recent failures
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.ugc_translation_summary AS
SELECT
  l.locale,
  (SELECT count(*) FROM ugc_translation_jobs WHERE target_locale = l.locale AND status = 'pending') AS queue_pending,
  (SELECT count(*) FROM ugc_translation_jobs WHERE target_locale = l.locale AND status = 'failed') AS queue_failed,
  (SELECT count(*) FROM ugc_translations WHERE target_locale = l.locale AND status IN ('qa_passed','approved')) AS translated_ok,
  (SELECT count(*) FROM ugc_translations WHERE target_locale = l.locale AND status = 'qa_failed') AS qa_failed,
  (SELECT max(created_at) FROM i18n_qa_failures WHERE locale = l.locale) AS last_qa_failure_at
FROM (SELECT DISTINCT unnest(get_active_locales()) AS locale) l;

GRANT SELECT ON public.ugc_translation_summary TO authenticated;
REVOKE SELECT ON public.ugc_translation_summary FROM anon;

-- ---------------------------------------------------------------------
-- Nightly coverage audit cron (03:00 UTC)
-- ---------------------------------------------------------------------
SELECT cron.schedule(
  'i18n-coverage-audit-daily',
  '0 3 * * *',
  $$ SELECT public.audit_i18n_coverage(); $$
);

-- ---------------------------------------------------------------------
-- BDD scenarios I18N-UGC-001..014
-- ---------------------------------------------------------------------
INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type)
VALUES
  ('i18n-ugc', 18, 'I18N-UGC-001', 'New project enqueues jobs for all active locales',
   E'Given an active locale "es-ES" exists in profiles\nAnd the projects table is registered for translation\nWhen an admin creates a project with description "Build a chat app"\nThen [DB] a ugc_translation_jobs row exists for entity_table=projects, column=description, target_locale=es-ES, status=pending\nAnd [Code] the row''s source_hash equals sha256("Build a chat app")\nAnd [UI] no error toast is shown', 'not_built', 'none'),
  ('i18n-ugc', 18, 'I18N-UGC-002', 'Worker translates queued UGC and writes qa_passed',
   E'Given a pending job for projects.description in locale "fr-FR"\nWhen prewarm-ugc-worker runs\nThen [DB] ugc_translations row exists with status=qa_passed and translated_text non-empty\nAnd [DB] ugc_translation_jobs row status becomes done\nAnd [Code] AI gateway was called exactly once for this job', 'not_built', 'none'),
  ('i18n-ugc', 18, 'I18N-UGC-003', 'Read hook returns cached translation immediately',
   E'Given a qa_passed ugc_translations row for projects/123/description/ja-JP exists\nWhen a Japanese-locale user views project 123\nThen [UI] the description renders in Japanese on first paint\nAnd [Code] no insert into ugc_translation_jobs occurred\nAnd [DB] no new ugc_translation_jobs row is created', 'not_built', 'none'),
  ('i18n-ugc', 18, 'I18N-UGC-004', 'Cold-locale miss shows source then swaps on realtime',
   E'Given no ugc_translations row exists for projects/123/description/sw-KE\nWhen a Swahili user opens project 123\nThen [UI] the English source renders immediately with a "Translating…" badge\nAnd [DB] a realtime-priority job is inserted\nAnd [UI] when the worker completes, the translation swaps in without a page refresh\nAnd [UI] the "Translating…" badge disappears', 'not_built', 'none'),
  ('i18n-ugc', 18, 'I18N-UGC-005', 'Edit invalidates only the affected entity translations',
   E'Given qa_passed translations exist for project 123 in 5 locales\nWhen the project description is updated to a new value\nThen [DB] new ugc_translation_jobs rows exist with the new source_hash for all 5 active locales\nAnd [DB] no other project''s ugc_translations rows are touched\nAnd [Code] the old translations remain queryable until replaced (no orphan window)', 'not_built', 'none'),
  ('i18n-ugc', 18, 'I18N-UGC-006', 'PII-flagged columns are never translated',
   E'Given i18n_content_registry has is_pii=true for profiles.email\nWhen any profile row is inserted or updated\nThen [DB] zero ugc_translation_jobs rows are created for column_name=email\nAnd [Code] the trigger short-circuits PII columns before hashing', 'not_built', 'none'),
  ('i18n-ugc', 18, 'I18N-UGC-007', 'QA failure stores attempt and serves source',
   E'Given the worker produces output identical to source for a non-en locale\nWhen the job is processed\nThen [DB] ugc_translations row has status=qa_failed and qa_report.gate=language\nAnd [DB] an i18n_qa_failures row records the attempt\nAnd [UI] the entity renders the source text (no broken empty render)', 'not_built', 'none'),
  ('i18n-ugc', 18, 'I18N-UGC-008', 'Brand lock prevents "Tech Fleet" from being translated',
   E'Given source text "Welcome to Tech Fleet"\nWhen worker returns output without the phrase "Tech Fleet"\nThen [DB] the row is marked qa_failed with gate=brand_lock\nAnd [DB] an i18n_qa_failures row is written', 'not_built', 'none'),
  ('i18n-ugc', 18, 'I18N-UGC-009', 'Placeholders preserved across translation',
   E'Given source text "Hello {name}, you have {count} messages"\nWhen the worker translates to any locale\nThen [DB] the qa_passed translated_text contains both {name} and {count} exactly once\nAnd [Code] qa_report.gate_failed is null', 'not_built', 'none'),
  ('i18n-ugc', 18, 'I18N-UGC-010', 'Daily cost cap halts new work',
   E'Given 10,000 ugc_translations rows have been inserted in the last 24 hours\nWhen prewarm-ugc-worker runs\nThen [Code] the response body is {"skipped":"daily_cap", ...}\nAnd [DB] no new ugc_translations rows are created in this invocation\nAnd [UI] System Health Translations tab shows cap-tripped badge', 'not_built', 'none'),
  ('i18n-ugc', 18, 'I18N-UGC-011', 'Backfill RPC enqueues all existing rows once',
   E'Given 100 existing projects and 3 active locales\nWhen an admin calls backfill_ugc_translations(NULL)\nThen [DB] up to 300 new ugc_translation_jobs rows are created (one per project x locale x translatable column, deduped against existing qa_passed)\nAnd [Code] the function rejects callers without admin role\nAnd [UI] System Health shows queue depth rising', 'not_built', 'none'),
  ('i18n-ugc', 18, 'I18N-UGC-012', 'Coverage audit writes nightly snapshot',
   E'When audit_i18n_coverage() runs at 03:00 UTC\nThen [DB] one i18n_coverage_audit row per active locale is inserted with coverage_pct and ugc_coverage_pct\nAnd [DB] rows older than 30 days are deleted\nAnd [UI] the Translations tab displays the freshest snapshot', 'not_built', 'none'),
  ('i18n-ugc', 18, 'I18N-UGC-013', 'Admin can view queue and recent QA failures',
   E'Given an admin opens System Health > Translations\nWhen the page loads\nThen [UI] queue depth, qa_failed count, last failure time, and per-locale coverage % are visible\nAnd [Code] ugc_translation_summary view returns one row per active locale\nAnd [DB] non-admin users cannot select from i18n_qa_failures', 'not_built', 'none'),
  ('i18n-ugc', 18, 'I18N-UGC-014', 'Source-hash dedupe prevents duplicate work',
   E'Given a ugc_translation_jobs row already exists for entity X / column Y / locale Z / hash H with status=pending\nWhen the trigger fires again with identical content\nThen [DB] no second job row is created (the unique deduplication index holds)\nAnd [Code] the trigger completes without error', 'not_built', 'none')
ON CONFLICT (scenario_id) DO NOTHING;
