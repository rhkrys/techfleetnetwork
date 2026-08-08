-- BDD for the Groq ANSWER-model migration (llama-3.3-70b-versatile deprecating
-- 2026-08-16 -> would fail like the retired embedding model). PR6 moves every
-- call site onto a single GROQ_MODEL constant (openai/gpt-oss-120b) with
-- reasoning_effort pinned low to protect the streaming latency SLO.
-- Executable coverage: src/test/smoke/fleety-answer-model.smoke.test.ts (vitest, CI).

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('FLEETY-010', 'Fleety', 30,
   'Fleety answers on a current, single-sourced Groq model at low reasoning effort',
   'Feature: Durable answer model\n  Scenario: no deprecated answer model remains in any call site\n    Given Groq is deprecating llama-3.3-70b-versatile (shutoff 2026-08-16)\n    When Fleety routes intent and generates an answer and records cost\n    Then every call site uses the GROQ_MODEL constant, never a literal model string\n    And GROQ_MODEL is a current non-Meta OpenAI open-weight model (openai/gpt-oss-20b; 120b available for higher quality)\n  Scenario: reasoning stays off the streaming critical path\n    Given gpt-oss is reasoning-capable and Fleety streams with a p95<3s SLO\n    When a generation request is sent to Groq\n    Then reasoning_effort is pinned low\n    And any reasoning is emitted on delta.reasoning, never delta.content, so the client stream stays clean',
   'implemented', 'unit', 'src/test/smoke/fleety-answer-model.smoke.test.ts',
   'PR6: retire the deprecating Groq answer model. Single source of truth (GROQ_MODEL) across router + main generation + cost + log; gpt-oss-120b is both faster (~500 vs ~280 tok/s) and higher quality than llama-3.3-70b. reasoning_effort=low protects latency; a reasoning-heavy sibling feature can reuse the same model at effort=high. Answer-quality e2e is verified post-deploy against the live function.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();
