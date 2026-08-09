-- BDD scenario for audit H15 — translation endpoints auth + spend cap.
BEGIN;

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('TRANSLATE-SPEND-H15-001', 'Access control', 62,
   'AI translation endpoints require a real JWT and cap per-identity spend',
   'Feature: bounded AI translation spend\n  Scenario: garbage bearer token\n    Given a request to translate-strings with Authorization "Bearer x"\n    When guardTranslationRequest validates it via getClaims\n    Then it is rejected 401 unauthorized (no LLM call, no counter write)\n  Scenario: anonymous page-load i18n still works\n    Given a request carrying the genuine anon JWT\n    Then getClaims succeeds and the request proceeds (subject to the rate limit)\n  Scenario: spend ceiling\n    Given an identity exceeds the per-minute translation cap\n    When it calls translate-strings/translate-bundle again\n    Then check_translation_rate_limit returns allowed=false and the fn returns 429',
   'implemented', 'unit',
   'src/test/smoke/translate-spend-cap.smoke.test.ts',
   'H15: replaced the Bearer-prefix-only check with getClaims validation + a dedicated per-identity (uid or hashed IP) rate limiter (translation_rate_limits + check_translation_rate_limit). translate-bundle is the medium-severity twin, fixed together.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();

COMMIT;
