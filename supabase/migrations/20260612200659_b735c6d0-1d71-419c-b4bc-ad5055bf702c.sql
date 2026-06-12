
UPDATE public.agent_fix_queue
SET status = 'resolved',
    resolved_at = now(),
    dismissed_reason = 'superseded_by_deploy: get_dashboard_overview refactored to 0-arg (migration 20260611042504); cache-identity-guard shipped (JOURNEY-IDENTITY-001..004)',
    updated_at = now()
WHERE status NOT IN ('resolved','dismissed','wont_fix')
  AND (
    error_message ILIKE '%get_dashboard_overview(p_user_id)%'
    OR fingerprint ILIKE 'client_error::query.dashboard-overview.%::AppError: Unauthorized%'
    OR fingerprint IN (
      '95d00d27c586d71213246c3b41fec44e539b5530a0aec4bf431bab05179b788b',
      '411d4d9d909d098653f831a569c200718d9ac63b6051f544957d46b1ecc73cbd'
    )
  );

UPDATE public.agent_fix_queue
SET status = 'resolved',
    resolved_at = now(),
    dismissed_reason = 'root_cause_fix: dom-translator now skips aria-live + role=status|alert|log|timer; AutosaveStatus carries data-no-translate + translate=no (TRANSLATOR-VOLATILE-001..003)',
    updated_at = now()
WHERE status NOT IN ('resolved','dismissed','wont_fix')
  AND fingerprint LIKE 'ui_render_error::ErrorBoundary:%::Error: NotFoundError: Failed to execute ''removeChild''%';

INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, notes)
VALUES
  ('i18n/dom-translator', 64001, 'TRANSLATOR-VOLATILE-001',
   'DOM translator skips ARIA live regions',
   'Feature: Runtime DOM translator must not touch React-volatile regions
  Scenario: aria-live region survives language switch
    Given the active locale is non-English
      And the page contains a <span role="status" aria-live="polite"> rendered by React
    When React re-renders the region with new text
    Then [UI] no error boundary trips and the text updates cleanly
      And [DB] no row is inserted into agent_fix_queue with fingerprint matching ui_render_error::%removeChild%
      And [Code] shouldSkipElement() in src/lib/i18n/dom-translator.ts returns true for the region',
   'implemented', 'unit',
   'Root-cause fix for System Health 2026-06-11 AutosaveStatus regression.'),
  ('i18n/dom-translator', 64002, 'TRANSLATOR-VOLATILE-002',
   'AutosaveStatus cycles states without translator race',
   'Feature: AutosaveStatus is inert to the DOM translator
  Scenario: pill cycles idle -> saving -> saved -> error in non-English locale
    Given the active locale is non-English
      And an <AutosaveStatus> is mounted
    When useAutosave drives status through saving, saved, then error
    Then [UI] the pill updates without throwing and without flicker
      And [DB] no triage row is created for the cycle
      And [Code] the translator never enqueues the pill''s text (data-no-translate + translate="no" + role="status")',
   'implemented', 'unit', NULL),
  ('i18n/dom-translator', 64003, 'TRANSLATOR-VOLATILE-003',
   'Legacy n boolean attribute is still honored',
   'Feature: Back-compat for legacy translator opt-out
  Scenario: element with `n` attribute is skipped
    Given an element carries the legacy boolean `n` attribute
    When the translator walks the DOM
    Then [Code] shouldSkipElement returns true for the element
      And [UI] no visible text inside is translated
      And [DB] no audit row is created for the skipped element',
   'implemented', 'unit', 'Translator honors both data-no-translate (canonical) and n (legacy).'),
  ('system-health/triage', 64004, 'DASHBOARD-RPC-RESIDUE-001',
   'Stale fingerprints are auto-closed on supersede',
   'Feature: agent_fix_queue surfaces only live problems
  Scenario: stale get_dashboard_overview(p_user_id) rows close automatically
    Given the 0-arg get_dashboard_overview refactor has shipped
      And agent_fix_queue contains rows referencing get_dashboard_overview(p_user_id)
    When the resolve-stale-fingerprints migration runs
    Then [DB] those rows have status=resolved and dismissed_reason starting with superseded_by_deploy
      And [UI] the System Health > Triage tab no longer shows them
      And [Code] no application call paths reference the 1-arg RPC signature',
   'implemented', 'manual', NULL)
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title,
  gherkin = EXCLUDED.gherkin,
  status = EXCLUDED.status,
  test_type = EXCLUDED.test_type,
  notes = EXCLUDED.notes,
  updated_at = now();
