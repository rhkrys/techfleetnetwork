
-- 1. Refresh registry to match real schema
DELETE FROM public.i18n_content_registry
WHERE (table_name, column_name) IN (
  ('projects','title'), ('projects','brief'),
  ('applications','essay_response'),
  ('clients','description'),
  ('courses','title'), ('courses','description'),
  ('lessons','title'), ('lessons','body')
);

INSERT INTO public.i18n_content_registry (table_name, column_name, content_format, priority, max_chars, is_pii, is_active)
VALUES
  ('clients','mission','plain','warm',5000,false,true),
  ('clients','project_summary','markdown','warm',10000,false,true),
  ('projects','description','markdown','hot',5000,false,true),
  ('profiles','professional_background','plain','cold',5000,false,true),
  ('profiles','professional_goals','plain','cold',5000,false,true),
  ('project_applications','client_project_knowledge','plain','warm',5000,false,true),
  ('project_applications','cross_functional_contribution','plain','warm',5000,false,true),
  ('project_applications','passion_for_project','plain','warm',5000,false,true),
  ('project_applications','previous_phase_help_teammates','plain','warm',5000,false,true),
  ('project_applications','previous_phase_learnings','plain','warm',5000,false,true),
  ('project_applications','previous_phase_position','plain','warm',5000,false,true),
  ('project_applications','prior_engagement_preparation','plain','warm',5000,false,true),
  ('project_applications','project_success_contribution','plain','warm',5000,false,true),
  ('general_applications','about_yourself','plain','warm',5000,false,true),
  ('general_applications','agile_philosophies','plain','warm',5000,false,true),
  ('general_applications','agile_vs_waterfall','plain','warm',5000,false,true),
  ('general_applications','collaboration_challenges','plain','warm',5000,false,true),
  ('general_applications','previous_engagement','plain','warm',5000,false,true),
  ('general_applications','psychological_safety','plain','warm',5000,false,true),
  ('general_applications','service_leadership_actions','plain','warm',5000,false,true),
  ('general_applications','service_leadership_challenges','plain','warm',5000,false,true),
  ('general_applications','service_leadership_definition','plain','warm',5000,false,true),
  ('general_applications','service_leadership_situation','plain','warm',5000,false,true),
  ('general_applications','teammate_learnings','plain','warm',5000,false,true),
  ('course_catalog','display_label','plain','hot',300,false,true)
ON CONFLICT (table_name, column_name) DO UPDATE
  SET content_format = EXCLUDED.content_format,
      priority = EXCLUDED.priority,
      max_chars = EXCLUDED.max_chars,
      is_active = true;

-- 2. Attach triggers to every registered table (idempotent, real tables only)
DO $$
DECLARE v_table text;
BEGIN
  FOR v_table IN
    SELECT DISTINCT r.table_name
    FROM public.i18n_content_registry r
    JOIN information_schema.tables t
      ON t.table_schema='public' AND t.table_name = r.table_name
    WHERE r.is_active = true
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_ugc_translate_%I ON public.%I', v_table, v_table);
    EXECUTE format(
      'CREATE TRIGGER trg_ugc_translate_%I AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enqueue_ugc_translation_jobs()',
      v_table, v_table
    );
  END LOOP;
END $$;

-- 3. BDD scenarios I18N-UGC-001..014
INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin)
VALUES
  ('I18N-UGC-001','i18n-ugc',18,'New project enqueues translation jobs for all active locales',
$g$Feature: UGC translation enqueue
  Scenario: New project enqueues jobs
    Given active locales include en, es, fr
    When an admin creates a project with description "Build a recruiting dashboard"
    Then [DB] ugc_translation_jobs has 3 rows for that project.description
    And  [Code] Trigger trg_ugc_translate_projects fired with TG_OP=INSERT
    And  [UI] No user-visible delay on the create form$g$),
  ('I18N-UGC-002','i18n-ugc',18,'Worker drains realtime queue and writes qa_passed rows',
$g$Feature: UGC worker
  Scenario: Drain queue
    Given ugc_translation_jobs has 10 realtime jobs
    When prewarm-ugc-worker runs once
    Then [DB] 10 ugc_translations rows exist with status=qa_passed
    And  [Code] Worker logged ai_gateway.success count=10
    And  [UI] Translated content visible within 30s of source write$g$),
  ('I18N-UGC-003','i18n-ugc',18,'Editing source invalidates stale translations',
$g$Feature: UGC invalidation
  Scenario: Edit source
    Given a project has qa_passed translations in es and fr
    When the owner edits project.description
    Then [DB] new ugc_translation_jobs rows enqueued with new source_hash
    And  [Code] trigger detects hash change via NEW vs OLD comparison
    And  [UI] stale translation badge appears then refreshes via realtime$g$),
  ('I18N-UGC-004','i18n-ugc',18,'Cold-locale read shows source then translates lazily',
$g$Feature: UGC lazy fill
  Scenario: Cold locale
    Given no translation exists for project.description in sw-KE
    When a Swahili user opens the project page
    Then [UI] source text renders immediately with "Translating..." badge
    And  [DB] a new realtime job is inserted into ugc_translation_jobs
    And  [Code] useUgcTranslation returns isTranslating=true on first call$g$),
  ('I18N-UGC-005','i18n-ugc',18,'QA gate rejects profanity and falls back to source',
$g$Feature: UGC QA
  Scenario: Banned term
    Given AI translation contains a banned term from i18n_banned_terms
    When worker validates the translation through 6-gate QA
    Then [DB] row written with status=qa_failed and qa_report.gate=denylist
    And  [Code] worker emits qa_failed metric
    And  [UI] source text shown, no translated text leaks$g$),
  ('I18N-UGC-006','i18n-ugc',18,'Cost guard caps translations at 10k per day',
$g$Feature: UGC cost guard
  Scenario: Cap
    Given daily translation counter is at 9990
    When 100 new write events fire triggers
    Then [DB] jobs remain pending past the 10000 cap
    And  [Code] worker logs cost_guard_tripped event
    And  [UI] admin sees alert in System Health Translations tab$g$),
  ('I18N-UGC-007','i18n-ugc',18,'Same-language source skips translation',
$g$Feature: UGC same-language
  Scenario: Skip en->en
    Given source text detected as en, target locale is en
    When trigger evaluates job enqueue
    Then [DB] no row inserted into ugc_translation_jobs for en->en
    And  [Code] enqueue_ugc_translation_jobs short-circuits identical locales
    And  [UI] user sees original text unchanged$g$),
  ('I18N-UGC-008','i18n-ugc',18,'Admin override locks translation against AI rewrites',
$g$Feature: UGC override
  Scenario: Locked row
    Given an admin edited a Spanish translation and saved
    When source text is edited later
    Then [DB] ugc_translations.is_admin_edited=true row preserved; new pending row created for review
    And  [Code] worker honors is_admin_edited flag
    And  [UI] admin sees a re-review prompt in the Translations tab$g$),
  ('I18N-UGC-009','i18n-ugc',18,'Realtime swap without refresh',
$g$Feature: UGC realtime
  Scenario: Swap
    Given user is viewing a project page with source text shown
    When worker writes the qa_passed translation row
    Then [UI] translated text replaces source within 1s without page reload
    And  [DB] supabase_realtime publication includes ugc_translations
    And  [Code] useUgcTranslation subscribes to postgres_changes$g$),
  ('I18N-UGC-010','i18n-ugc',18,'Bulk create 200 projects drains queue without 429s',
$g$Feature: UGC scale
  Scenario: Backfill 200
    Given admin uses backfill_ugc_translations to seed 200 projects
    When worker runs over next 10 minutes
    Then [DB] all jobs reach qa_passed or qa_failed; none remain pending after 10min
    And  [Code] CircuitBreaker did not trip
    And  [UI] coverage dashboard shows 100% for active locales$g$),
  ('I18N-UGC-011','i18n-ugc',18,'PII columns are never translated',
$g$Feature: UGC PII safety
  Scenario: Email
    Given profiles.email is registered with is_pii=true
    When a profile email is updated
    Then [DB] no job enqueued for profiles.email
    And  [Code] trigger CONTINUEs on is_pii rows
    And  [UI] email shown as-is in every locale$g$),
  ('I18N-UGC-012','i18n-ugc',18,'Max char cap skips translation',
$g$Feature: UGC cap
  Scenario: Over cap
    Given a project.description is 6000 chars (cap 5000)
    When trigger evaluates
    Then [DB] no job enqueued
    And  [Code] trigger CONTINUEs when length > max_chars
    And  [UI] user sees Translate this passage button instead of auto-translation$g$),
  ('I18N-UGC-013','i18n-ugc',18,'Markdown structure preserved through translation',
$g$Feature: UGC markdown
  Scenario: Headings and lists
    Given source is markdown with headings and a bulleted list
    When worker translates to fr
    Then [DB] qa_report.structural_diff=passed
    And  [Code] format-aware prompt used for content_format=markdown
    And  [UI] rendered output keeps the same headings and list structure$g$),
  ('I18N-UGC-014','i18n-ugc',18,'Backfill RPC enqueues for specific locales only',
$g$Feature: UGC backfill
  Scenario: Seed ja+ko
    Given admin requests backfill for [ja, ko]
    When backfill_ugc_translations_for_locales runs
    Then [DB] jobs created only for ja and ko, not other locales
    And  [Code] RPC respects p_locales array and bypasses 7d active filter
    And  [UI] System Health shows ja and ko coverage climbing$g$)
ON CONFLICT (scenario_id) DO UPDATE
  SET title = EXCLUDED.title, gherkin = EXCLUDED.gherkin;

-- 4. Realtime publication for ugc_translations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='ugc_translations'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.ugc_translations';
  END IF;
END $$;
