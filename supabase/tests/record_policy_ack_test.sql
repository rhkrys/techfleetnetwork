-- pgTAP suite for audit T-A — record_policy_ack must persist consent on the
-- profile keyed by user_id (was keyed on the random PK -> 0-row no-op, so
-- electronic_comms_consent_at never got set and consent was understated).
BEGIN;
SELECT plan(4);

INSERT INTO auth.users (id, email)
VALUES ('11111111-1111-1111-1111-111111111111', 'consent@example.com')
ON CONFLICT (id) DO NOTHING;
-- handle_new_user may have already created the profile row from the auth insert;
-- either way ensure exactly one profile exists for this user.
INSERT INTO public.profiles (user_id, email, display_name)
VALUES ('11111111-1111-1111-1111-111111111111', 'consent@example.com', 'Consent Tester')
ON CONFLICT (user_id) DO NOTHING;

-- The whole bug: profiles.id (PK) is NOT the auth uid.
SELECT isnt(
  (SELECT id FROM public.profiles WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'profiles.id (random PK) != user_id — an UPDATE keyed on id no-ops');

-- Act as that authenticated user (auth.uid() reads request.jwt.claims.sub).
SELECT set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
SELECT set_config('role', 'authenticated', true);

SELECT public.record_policy_ack(
  ARRAY['privacy'], '2026-08-09', 'checkbox', '127.0.0.1'::inet, 'pgTAP', true, NULL
);

SELECT set_config('role', 'postgres', true);  -- back to superuser for assertions

SELECT isnt(
  (SELECT electronic_comms_consent_at FROM public.profiles
    WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  NULL,
  'record_policy_ack persists electronic_comms_consent_at (T-A fix: keyed on user_id)');

SELECT is(
  (SELECT count(*)::int FROM public.policy_acknowledgments
    WHERE user_id = '11111111-1111-1111-1111-111111111111' AND policy_key = 'privacy'),
  1,
  'the acknowledgment row was recorded');

SELECT is(
  (SELECT electronic_comms_consent FROM public.policy_acknowledgments
    WHERE user_id = '11111111-1111-1111-1111-111111111111' AND policy_key = 'privacy'),
  true,
  'electronic_comms_consent captured on the ack row');

SELECT * FROM finish();
ROLLBACK;
