INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, test_file, notes)
VALUES
('Authentication', 2, 'AUTH-RESET-020', 'Recovery link works cross-device',
$g$Feature: Password reset cross-device
  Scenario: Member requests reset on phone and clicks link on laptop
    Given a member has requested a password reset on Device A
    When the recovery email is opened and the link is clicked on Device B (no prior session)
    Then [UI] the reset password form renders with both password fields enabled
    And [Code] ResetPasswordPage takes the token_hash branch and calls supabase.auth.verifyOtp({type:"recovery"})
    And [DB] an audit_log row "reset_settle_token_hash_ok" with severity:info is written
    And [UI] the URL no longer contains token_hash or type query params after settle$g$,
'not_built', 'none', '', 'Permanent fix for cross-device recovery'),
('Authentication', 2, 'AUTH-RESET-021', 'Recovery link works in incognito window',
$g$Feature: Password reset in incognito
  Scenario: Member opens recovery link in a private/incognito window
    Given a member receives a recovery email
    When they open the link in an incognito window with no existing Supabase session in storage
    Then [UI] the reset password form renders successfully
    And [Code] verifyOtp creates a fresh recovery session in the incognito storage
    And [DB] audit_log row "reset_settle_token_hash_ok" is written
    And [UI] "Invalid or expired link" is NOT shown$g$,
'not_built', 'none', '', ''),
('Authentication', 2, 'AUTH-RESET-022', 'Recovery link clicked twice remains usable until OTP consumed',
$g$Feature: Password reset link idempotency
  Scenario: Member clicks the recovery link twice before resetting
    Given a member receives a recovery email
    When they click the link a first time and the form renders
    And they click the same link a second time in a new tab before submitting
    Then [UI] both tabs render the reset form (verifyOtp is idempotent until consumed)
    And [Code] both calls to supabase.auth.verifyOtp succeed
    When the member submits a new password from the first tab
    Then [DB] a password_updated audit_log row is written exactly once
    And [UI] reloading the second tab now shows "Invalid or expired link"$g$,
'not_built', 'none', '', ''),
('Authentication', 2, 'AUTH-RESET-023', 'Sensitive URL params are stripped after settle',
$g$Feature: Password reset URL hygiene
  Scenario: Recovery params are removed from the address bar after the page settles
    Given a member opens a recovery link of the form /reset-password?token_hash=...&type=recovery
    When ResetPasswordPage successfully verifies the OTP
    Then [UI] window.location.search no longer contains token_hash, type, code, access_token, or refresh_token
    And [Code] history.replaceState was called with a cleaned URL
    And [DB] no token material is present in any audit_log payload$g$,
'not_built', 'none', '', '')
ON CONFLICT (scenario_id) DO UPDATE
SET title = EXCLUDED.title, gherkin = EXCLUDED.gherkin,
    feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
    notes = EXCLUDED.notes, updated_at = now();