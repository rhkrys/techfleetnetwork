CREATE OR REPLACE FUNCTION public.enforce_confirmed_password_update_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.event_type = 'password_updated'
     AND NOT (COALESCE(NEW.changed_fields, ARRAY[]::text[]) @> ARRAY['confirmed:true']::text[]) THEN
    RAISE EXCEPTION 'password_updated audit events require confirmed:true metadata';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_password_updated_confirmed ON public.audit_log;
CREATE TRIGGER trg_audit_log_password_updated_confirmed
BEFORE INSERT ON public.audit_log
FOR EACH ROW
EXECUTE FUNCTION public.enforce_confirmed_password_update_audit();

INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, test_file, notes)
VALUES
  (
    'Authentication',
    2,
    'AUTH-RESET-010',
    'Mismatched reset password confirmation is blocked',
    'Given a member is on the reset password page with a valid recovery session\nWhen they type different values in New password and Confirm new password\nThen [UI] the update button remains disabled and a mismatch alert is shown\nAnd [DB] no password_updated audit row is written\nAnd [Code] AuthService.updatePassword is not called',
    'implemented',
    'unit',
    'src/test/ui/ResetPasswordPage.test.tsx',
    'Auth credential mutation invariant: confirm-password required.'
  ),
  (
    'Authentication',
    2,
    'AUTH-RESET-011',
    'Password reset works after a fresh sign-in round trip',
    'Given a member completes password reset with matching password fields\nWhen they sign out and sign in again with the new password\nThen [UI] the dashboard is reached\nAnd [DB] audit_log has password_updated with confirmed:true\nAnd [Code] the password update path goes through update-password-confirmed',
    'implemented',
    'e2e',
    'e2e/auth/password-reset-roundtrip.e2e.ts',
    'Critical auth regression gate.'
  ),
  (
    'Authentication',
    2,
    'AUTH-RESET-012',
    'Unconfirmed password update audit rows are rejected',
    'Given a future code path attempts to write password_updated without confirmed:true\nWhen the audit row insert runs\nThen [UI] no success state is shown\nAnd [DB] the audit trigger rejects the row\nAnd [Code] CI fails the invariant test',
    'implemented',
    'unit',
    'src/test/services/auth.service.test.ts',
    'Database backstop for password mutation confirmation.'
  )
ON CONFLICT (scenario_id) DO UPDATE SET
  feature_area = EXCLUDED.feature_area,
  feature_area_number = EXCLUDED.feature_area_number,
  title = EXCLUDED.title,
  gherkin = EXCLUDED.gherkin,
  status = EXCLUDED.status,
  test_type = EXCLUDED.test_type,
  test_file = EXCLUDED.test_file,
  notes = EXCLUDED.notes,
  updated_at = now();