INSERT INTO public.bdd_scenarios (scenario_id, title, feature_area, feature_area_number, gherkin, status)
VALUES
  ('AUTH-ARCH-CUTOVER-007','Sign-up is owned by sign-up.service.ts','auth/architecture',1100,
   $$Scenario: New-account sign-up routes through the use-case service
  Given a member submits the registration form with a valid email, password, and captcha
  When the engine calls sessionPort.signUp
  Then [UI] the verification-email-sent screen renders
   And [DB] ops_events contains kind 'auth_engine.sign_up_succeeded' for that actor
   And [Code] sessionPort.signUp resolves to the value returned by signUp from src/features/auth/services/sign-up.service.ts
   And [Code] AuthService.signUp is a thin delegator to the same service$$,
   'implemented'),
  ('AUTH-ARCH-CUTOVER-008','Password-reset request is owned by request-password-reset.service.ts','auth/architecture',1100,
   $$Scenario: Forgot-password engine routes through the use-case service
  Given a member submits /forgot-password with a valid email and captcha
  When the engine calls sessionPort.resetPassword
  Then [UI] the constant-shape success screen renders (anti-enumeration)
   And [DB] ops_events contains kind 'auth_engine.forgot_accepted'
   And [DB] email_send_log records a 'recovery' row within 60 seconds OR ops_events contains 'auth_engine.forgot_email_delivery_unverified'
   And [Code] sessionPort.resetPassword === requestPasswordReset from src/features/auth/services/request-password-reset.service.ts$$,
   'implemented'),
  ('AUTH-ARCH-CUTOVER-009','Account-identity hint is owned by identity-hint.service.ts','auth/architecture',1100,
   $$Scenario: identity hint check is fail-open and isolated
  Given a request to identify if an email has a password or Google identity
  When the engine calls checkAccountIdentity
  Then [Code] the call resolves to {has_password:true, has_google:false} on edge-function error (fail-open)
   And [DB] no ops_events 'auth_engine.*_failed' row is written by identity hint
   And [Code] AuthService.checkAccountIdentity delegates to identity-hint.service.ts$$,
   'implemented'),
  ('AUTH-ARCH-CUTOVER-010','Password-reset completion is owned by complete-password-reset.service.ts','auth/architecture',1100,
   $$Scenario: ResetPassword screen routes through the use-case service
  Given the member opens a valid recovery session and submits a new password
  When the engine calls sessionPort.updatePassword
  Then [UI] the success screen with sign-in CTA renders
   And [DB] account_activity contains 'password_updated'
   And [Code] sessionPort.updatePassword === completePasswordReset from src/features/auth/services/complete-password-reset.service.ts$$,
   'implemented'),
  ('AUTH-ARCH-CUTOVER-011','Auth engines never swallow errors without telemetry','auth/architecture',1100,
   $$Scenario: Engine catch blocks emit telemetry
  Given any try/catch inside src/features/auth/engine/**
  When the catch block executes
  Then [Code] the block calls telemetryPort.record(...) or telemetryPort.captcha(...) inside the catch body
   And [Code] scripts/ci/check-auth-engine-swallow.mjs exits 0 in CI$$,
   'implemented'),
  ('AUTH-ARCH-CUTOVER-012','AuthService no longer owns auth-credential logic','auth/architecture',1100,
   $$Scenario: AuthService is a thin compatibility shim for sign-up / reset / update
  Given the file src/services/auth.service.ts is read
  When we count lines containing supabase.auth.signUp, supabase.auth.resetPasswordForEmail, supabase.auth.updateUser, supabase.auth.resend
  Then [Code] the count is 0
   And [Code] AuthService.signUp/resendSignupConfirmation/resetPassword/updatePassword/checkAccountIdentity are all single-line delegators to src/features/auth/services/* exports$$,
   'implemented')
ON CONFLICT (scenario_id) DO UPDATE
  SET title=EXCLUDED.title, feature_area=EXCLUDED.feature_area, feature_area_number=EXCLUDED.feature_area_number,
      gherkin=EXCLUDED.gherkin, status=EXCLUDED.status, updated_at=now();