INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, test_file) VALUES
('Auth Resilience', 42, 'AUTH-LOCK-RETRY-003', 'useMfaGate dedupes concurrent MFA-gate fetches', 'Feature: MFA-gate single-flight dedupe
  Scenario: Concurrent mounts share one in-flight RPC
    Given five components mount useMfaGate in the same tick for the same identity
    When React Query reconciles the in-flight key
    Then [UI] every consumer resolves to the same decision without flicker
    And [DB] admin_2fa_grace_active is called exactly once on the server
    And [Code] MfaService.getMfaGateDecision is invoked exactly once during the cohort window', 'implemented', 'unit', 'src/test/hooks/use-mfa-gate.dedupe.test.tsx'),
('Auth Resilience', 42, 'AUTH-MFA-GATE-DEDUPE-001', 'N hooks fan out to a single MFA-gate network call', 'Feature: MFA-gate fan-out collapse
  Scenario: Bootstrap fan-out collapses to one network call
    Given the dashboard mounts useAnnouncements, useDashboardOverview, MfaEnforcementGuard, and HeaderChip in parallel
    When each hook subscribes to queryKeys.mfaGate(userId)
    Then [UI] no MFA-gate-related skeleton flashes after the first paint
    And [DB] the GoTrue Web Lock is acquired exactly once across the cohort
    And [Code] getMfaGateDecision is called exactly once and re-mount within staleTime does not refetch', 'implemented', 'unit', 'src/test/hooks/use-mfa-gate.dedupe.test.tsx')
ON CONFLICT (scenario_id) DO UPDATE SET status='implemented', test_file=EXCLUDED.test_file, gherkin=EXCLUDED.gherkin, updated_at=now();