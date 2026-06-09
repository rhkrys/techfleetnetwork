INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin) VALUES
  ('Email Workspace Throttle', 10, 'EMAIL-RL-015', 'Workspace-quota 429 caps lane cooldown at 120s',
   'Feature: Bounded lane cooldown for workspace-quota 429s
  Scenario: EMAIL-RL-015
    Given the provider returns 429 with key rate_limit:workspace:email_send and Retry-After: 3500
    When process-email-queue records the 429 on the bulk lane
    Then [DB] bulk_retry_after_until is set no more than 120 seconds in the future
    And [DB] bulk_consecutive_rate_limits increments by 1
    And [Code] record_workspace_email_429() is called so the token bucket halves
    And [UI] System Health Bulk lane card shows "Throttled" with a "Resume now" button'),
  ('Email Workspace Throttle', 10, 'EMAIL-RL-016', 'Idle tick resets stale consecutive counter',
   'Feature: Idle counter reset
  Scenario: EMAIL-RL-016
    Given bulk_consecutive_rate_limits=2 and bulk_retry_after_until is in the past
    When process-email-queue starts a new tick for the bulk lane
    Then [DB] bulk_consecutive_rate_limits resets to 0 before any send is attempted
    And [Code] the next 429 backoff calculation starts from nextCount=1, not 3
    And [UI] System Health Bulk lane card shows "Normal"'),
  ('Email Workspace Throttle', 10, 'EMAIL-RL-017', 'Admin can clear a stuck lane cooldown',
   'Feature: clear_email_lane_cooldown admin RPC
  Scenario: EMAIL-RL-017
    Given bulk_retry_after_until is 30 minutes in the future
    When an admin invokes clear_email_lane_cooldown(''bulk_emails'')
    Then [DB] bulk_retry_after_until becomes NULL and bulk_consecutive_rate_limits becomes 0
    And [DB] audit_log gains a row with kind=email_lane_cooldown_cleared and severity=info
    And [Code] a non-admin caller receives a 42501 forbidden error
    And [UI] the System Health "Resume now" button shows a success toast and the lane returns to Normal within 5 seconds')
ON CONFLICT (scenario_id) DO UPDATE SET gherkin = EXCLUDED.gherkin, title = EXCLUDED.title;