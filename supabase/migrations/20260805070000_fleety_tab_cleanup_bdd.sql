-- BDD scenario for the Fleety admin-panel Lovable cleanup (PRD D-14/15/16, G-10).
-- Executable coverage: src/test/ui/FleetyHealthTab.cleanup.test.tsx (vitest, CI).

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('FLEETY-008', 'Fleety', 30,
   'Lovable-era Fleety admin tabs are removed; retained tabs still render',
   'Feature: Admin panel earns its keep (G-10)\n  Scenario: an admin opens the Fleety Learning panel\n    Then the Proposed relationships, Drafts, and Prompt Versions tabs are gone (P-11/P-12/P-13, D-14/15/16)\n    And the retained tabs render (Cost, Gaps, Playbook Gaps, Recent, Canned, + Canned Answer, Practical Content)',
   'implemented', 'unit', 'src/test/ui/FleetyHealthTab.cleanup.test.tsx',
   'Pure removal of dead Lovable-era surfaces; underlying tables untouched (deletion-safety: admin-only UI, no member impact). Verified by tsc + the render test.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();
