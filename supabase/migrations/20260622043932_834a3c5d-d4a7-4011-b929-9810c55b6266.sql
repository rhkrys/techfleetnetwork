INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, test_file) VALUES
('Auth/Admin', 64200, 'ADMIN-2FA-TIMEOUT-001', 'Admin route renders when grace RPC hangs',
$$Feature: Admin route resilience to stuck PostgREST stream
  Scenario: Admin opens /admin/* while admin_2fa_grace_active hangs
    Given the authenticated user has the admin role
    And the admin_2fa_grace_active RPC never resolves
    When the user navigates to an admin route
    Then [UI] the page renders the admin child within 9 seconds
    And [Code] rpcWithTimeout returns RPC_TIMEOUT error twice (initial + 1 retry)
    And [DB] an audit_log row is written with event_type=infra_transient and changed_fields contains fingerprint:admin_2fa_rpc_timeout
    And [DB] no row is inserted into agent_fix_queue for that fingerprint$$,
'not_built', 'unit', 'src/test/lib/rpc-with-timeout.test.ts'),
('Auth/Admin', 64201, 'ADMIN-2FA-TIMEOUT-002', 'Grace dialog does not pile up polls when RPC hangs',
$$Feature: AdminTwoFactorGraceDialog poll guard
  Scenario: Polling 10s interval while RPC is wedged
    Given the grace dialog is mounted for an admin without verified TOTP
    And the admin_2fa_grace_active RPC never resolves
    When 30 seconds elapse
    Then [Code] at most one in-flight call to admin_2fa_grace_active exists at any time
    And [UI] the dialog open state is unchanged across the wedge
    And [Code] graceActive and deadline keep their last-known values$$,
'not_built', 'unit', 'src/test/lib/rpc-with-timeout.test.ts'),
('Discord', 64202, 'DISCORD-RETRY-TIMEOUT-001', 'Discord role retry hook does not block on stuck RPC',
$$Feature: useDiscordRoleRetry timeout
  Scenario: list_pending_role_grants_for_user RPC hangs after sign-in
    Given the user has just signed in
    And list_pending_role_grants_for_user never resolves
    When the hook fires 1.5 seconds after mount
    Then [Code] rpcWithTimeout aborts after 8 seconds and returns RPC_TIMEOUT
    And [UI] no spinner or banner is rendered as a result
    And [DB] no row in discord_role_grants is mutated$$,
'not_built', 'unit', 'src/test/lib/rpc-with-timeout.test.ts');