-- BDD scenarios for support categories (PR #2a). Executable coverage:
-- src/test/smoke/support-categories.smoke.test.ts (CI vitest).
INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('HELP-DESK-060', 'Help Desk', 7,
   'Support categories are admin-managed reference data with RLS',
   'Feature: Category taxonomy\n  Scenario: who can read/manage categories\n    Then admins manage the taxonomy and read all rows\n    And members can only read active, non-internal categories',
   'implemented', 'unit', 'src/test/smoke/support-categories.smoke.test.ts',
   'is_internal hides sensitive categories (e.g. Safety) from members; admins CRUD via RLS.'),

  ('HELP-DESK-061', 'Help Desk', 7,
   'The taxonomy seeds Tech Fleet''s exact category list',
   'Feature: Seeded categories\n  Scenario: fresh install\n    Then Advice..Technical Help seed alphabetically and Other sorts last',
   'implemented', 'unit', 'src/test/smoke/support-categories.smoke.test.ts',
   'Owner-provided list; editable afterwards.'),

  ('HELP-DESK-062', 'Help Desk', 7,
   'A ticket can carry one category',
   'Feature: Ticket category\n  Scenario: tag a ticket\n    Then support_ticket_pointers.category_id references a category (ON DELETE SET NULL)',
   'implemented', 'unit', 'src/test/smoke/support-categories.smoke.test.ts',
   'Deleting a category soft-nulls the tag rather than breaking the ticket.'),

  ('HELP-DESK-063', 'Help Desk', 7,
   'Category reporting is admin-gated and hardened',
   'Feature: Category report\n  Scenario: an admin opens Reports\n    Then get_support_category_report is SECURITY DEFINER, pinned search_path, #variable_conflict use_column, and raises for non-admins',
   'implemented', 'unit', 'src/test/smoke/support-categories.smoke.test.ts',
   'Answers the PRD "common categories over time" goal; OWASP search-path hardening.'),

  ('HELP-DESK-064', 'Help Desk', 7,
   'Only admins can tag a ticket, and the category id is validated',
   'Feature: setCategory action\n  Scenario: tagging\n    Given the setCategory proxy action\n    Then it is admin-only and rejects an unknown/inactive category id with 422; null clears the tag',
   'implemented', 'unit', 'src/test/smoke/support-categories.smoke.test.ts',
   'Platform-side only (no Freescout call); ownership preserved via the null-owner upsert.'),

  ('HELP-DESK-065', 'Help Desk', 7,
   'The admin grid shows each ticket''s category',
   'Feature: Grid enrichment\n  Scenario: listAll for admins\n    Then each row is enriched with the platform-side category + private flag Freescout does not hold',
   'implemented', 'unit', 'src/test/smoke/support-categories.smoke.test.ts',
   'One pointer query + one category lookup per page.'),

  ('HELP-DESK-066', 'Help Desk', 7,
   'Admins tag from the grid and see a category report',
   'Feature: Category UX\n  Scenario: triage + reporting\n    Then the grid has a Category column + "Set category" picker\n    And the Reports tab renders tickets-by-category',
   'implemented', 'unit', 'src/test/smoke/support-categories.smoke.test.ts',
   'Set category submenu mirrors the assignee picker; CategoryReportPanel charts common topics.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  notes = EXCLUDED.notes, updated_at = now();
