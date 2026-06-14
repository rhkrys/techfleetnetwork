CREATE OR REPLACE FUNCTION public.resolve_stale_fingerprints_on_deploy(
  p_fingerprint_like text,
  p_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_fingerprint_like IS NULL OR length(p_fingerprint_like) < 4 THEN
    RAISE EXCEPTION 'p_fingerprint_like must be a non-trivial LIKE pattern';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'p_reason is required for audit trail';
  END IF;

  UPDATE public.agent_fix_queue
     SET status         = 'resolved',
         resolved_at    = now(),
         dismissed_reason = COALESCE(dismissed_reason, p_reason)
   WHERE status IN ('open', 'in_progress', 'triaged')
     AND (fingerprint ILIKE p_fingerprint_like
          OR error_message ILIKE p_fingerprint_like);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_stale_fingerprints_on_deploy(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_stale_fingerprints_on_deploy(text, text) TO service_role;

COMMENT ON FUNCTION public.resolve_stale_fingerprints_on_deploy(text, text) IS
  'Bulk-resolves agent_fix_queue rows whose fingerprint/error_message matches a LIKE pattern. Use from deploy migrations to close residue of a fix shipped in the same release.';

INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type) VALUES
(
  'TRANSLATOR-VOLATILE-001',
  'i18n DOM Translator',
  18,
  'Translator skips aria-live regions so React re-renders never throw removeChild',
  $bdd$Feature: DOM translator respects React-volatile regions
  Scenario: aria-live region survives reconciliation
    Given the active locale is non-English
    And a parent element with aria-live="polite" contains a text node
    When React re-renders and swaps the text node
    Then [UI] no ErrorBoundary trips and the new text is visible
    And  [DB] no row is inserted into agent_fix_queue with fingerprint matching ui_render_error::removeChild
    And  [Code] shouldSkipElement returns true for the aria-live ancestor$bdd$,
  'implemented', 'unit'
),
(
  'TRANSLATOR-VOLATILE-002',
  'i18n DOM Translator',
  18,
  'AutosaveStatus cycles idle/saving/saved/error without translator races',
  $bdd$Feature: AutosaveStatus + DOM translator coexistence
  Scenario: Status pill flips while a non-English locale is active
    Given the active locale is non-English
    And an AutosaveStatus is mounted
    When status transitions idle -> saving -> saved -> error
    Then [UI] the pill updates each label without flicker or unmount errors
    And  [DB] no triage row is created for query.autosave or ui_render_error
    And  [Code] the translator never enqueues the pill text (data-no-translate + translate="no")$bdd$,
  'implemented', 'unit'
),
(
  'TRANSLATOR-VOLATILE-003',
  'i18n DOM Translator',
  18,
  'Legacy n boolean attribute remains honored for back-compat',
  $bdd$Feature: Translator opt-out back-compat
  Scenario: Element with bare n attribute is skipped
    Given an element carries the legacy boolean attribute n
    When the translator walks the subtree under a non-English locale
    Then [UI] the text inside is left untranslated
    And  [Code] shouldSkipElement returns true for the n-tagged ancestor
    And  [Code] the CI guard scripts/ci/check-translator-volatile-regions.mjs warns on new occurrences of n outside an allow-list$bdd$,
  'implemented', 'unit'
),
(
  'DASHBOARD-RPC-RESIDUE-001',
  'System Health Triage',
  19,
  'Stale fingerprints are auto-closed when their fix migration runs',
  $bdd$Feature: Deploy-time residue cleanup
  Scenario: Migration closes superseded agent_fix_queue rows
    Given agent_fix_queue holds open rows whose fingerprint matches a shipped fix
    When the migration calls resolve_stale_fingerprints_on_deploy(<pattern>, <reason>)
    Then [DB] those rows transition to status=resolved with resolved_at=now() and dismissed_reason set
    And  [UI] the System Health Triage tab no longer surfaces them
    And  [Code] the function returns the count of rows it closed$bdd$,
  'implemented', 'unit'
)
ON CONFLICT (scenario_id) DO UPDATE
  SET gherkin = EXCLUDED.gherkin,
      status  = EXCLUDED.status,
      title   = EXCLUDED.title;

-- Demonstrative use: close any residue matching the two known dashboard fingerprints.
SELECT public.resolve_stale_fingerprints_on_deploy(
  '%get_dashboard_overview(p_user_id)%',
  'superseded_by_deploy: 1-arg shim deployed 2026-06-14'
);
SELECT public.resolve_stale_fingerprints_on_deploy(
  '%query.dashboard-overview%Unauthorized%',
  'superseded_by_deploy: ProgressCacheIdentityGuard shipped'
);