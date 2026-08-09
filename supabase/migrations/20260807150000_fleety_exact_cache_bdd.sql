-- BDD for FLEETY-014: L2 exact-match response cache. A verbatim repeat is served
-- with zero Groq call and WITHOUT depending on the embedding (resilient to an
-- embedding-provider outage), running in parallel with embed+router.
-- Executable coverage: src/test/smoke/fleety-exact-cache.smoke.test.ts (vitest, CI).

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('FLEETY-014', 'Fleety', 30,
   'Verbatim repeats hit an embedding-independent exact-match cache',
   'Feature: L2 exact-match response cache\n  Scenario: a verbatim repeat is served without calling the model\n    Given a grounded answer to "What is a deliverable?" is stored for this audience + kb_version\n    When the same question is asked again verbatim\n    Then fleety_cache_lookup matches by the normalized hash (audience|trim|lowercase)\n    And the stored markdown is replayed with header X-Fleety-Cache: hit-exact\n    And no Groq call is made\n  Scenario: exact cache still works while embeddings are degraded\n    Given the embedding provider is returning errors (queryEmbedding is null)\n    When a previously-cached question is asked verbatim\n    Then the L2 exact lookup (which needs no embedding) still returns the answer\n    And only the semantic L3 cache is skipped',
   'implemented', 'unit', 'src/test/smoke/fleety-exact-cache.smoke.test.ts',
   'Runs in parallel with embed+router (no added latency). Reuses the now-permanent fleety_cache_lookup (kb_version scoped; hits incremented by the RPC, so no double count). Serves only grounded answers (FLEETY-013) at the current kb_version. Complements the semantic L3 cache and adds outage resilience.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();
