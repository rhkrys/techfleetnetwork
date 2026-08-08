-- BDD for FLEETY-013: the permanent response cache stores GROUNDED answers only.
-- With the cache now permanent (FLEETY-011), an ungrounded reply would be served
-- for the life of its kb_version — so cache writes are gated on hasGrounding.
-- Executable coverage: src/test/smoke/fleety-cache-grounded.smoke.test.ts (vitest, CI).

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('FLEETY-013', 'Fleety', 30,
   'Only grounded answers are written to the permanent response cache',
   'Feature: Do not cache fabrications\n  Scenario: an ungrounded turn is never cached\n    Given retrieval is degraded and a turn has no KB/framework/canned/playbook/example/few-shot grounding\n    When Fleety answers the question\n    Then hasGrounding is false\n    And isCacheable is false so fleety_cache_store is not called\n    And no fabricated answer is persisted into the permanent cache\n  Scenario: a grounded turn is cached as before\n    Given a turn grounded by KB or framework context\n    Then isCacheable is true and the answer is stored for reuse',
   'implemented', 'unit', 'src/test/smoke/fleety-cache-grounded.smoke.test.ts',
   'Pairs with FLEETY-011 (permanent cache): since entries no longer time-expire, gating writes on grounding prevents a fabricated answer from being served for the life of the kb_version. Especially important while the KB re-embed is pending (retrieval degraded).')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();
