-- BDD for the embedding-model migration (text-embedding-004 retired -> 404).
-- Executable coverage: supabase/functions/_shared/gemini-embed.test.ts (deno,CI).

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('FLEETY-009', 'Fleety', 30,
   'Fleety embeds with the current model; query + ingest share one vector space',
   'Feature: Working retrieval\n  Scenario: the query side and the KB share an embedding space\n    Given Google retired text-embedding-004 (HTTP 404) which zeroed kb_hit_count\n    When a chat query is embedded and a KB row is embedded\n    Then both use gemini-embedding-001 at 768 dims via the shared contract\n    And the query uses taskType RETRIEVAL_QUERY and KB rows RETRIEVAL_DOCUMENT\n    And a retired model name can never be reintroduced (unit-guarded)\n  Scenario: re-embed picks up old/mislabeled rows\n    Given existing rows are labeled other than the current pipeline tag\n    Then the fleety-embed backfill re-embeds them into the matching space',
   'implemented', 'unit', 'supabase/functions/_shared/gemini-embed.test.ts',
   'Root-cause fix for kb_hit_count=0/fabrication: text-embedding-004 was retired. Single source of truth in _shared/gemini-embed.ts + error-body logging on embed failures so a model/key error is diagnosable. Requires a one-time re-embed (fleety-embed backfill) after deploy.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();
