-- pgTAP: audit T-A — support provisioning is keyed on the AUTH uid
-- (profiles.user_id), never the random profiles.id PK. Proves the trigger fixes
-- and the data-repair in 20260810120000. Runs in a rolled-back transaction.
BEGIN;
SELECT plan(4);

-- ── Fixture: one auth user (handle_new_user creates the profile; the profile
--    insert fires trg_profiles_provision_customer -> enqueues a customer row). ──
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('0a1b2c3d-0000-0000-0000-000000000001', 'ta-prov@example.com',
   '{"first_name":"Ta","last_name":"Prov"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- 1. The customer provisioning row is keyed on the auth uid (profiles.user_id).
SELECT is(
  (SELECT count(*)::int
     FROM public.support_provisioning_log spl
     JOIN public.profiles p ON p.user_id = spl.user_id
    WHERE p.email = 'ta-prov@example.com' AND spl.kind = 'customer'),
  1, 'customer provisioning is enqueued keyed on the auth uid (profiles.user_id)');

-- 2. NO provisioning row is keyed on the random profiles.id PK.
SELECT is(
  (SELECT count(*)::int
     FROM public.support_provisioning_log spl
     JOIN public.profiles p ON p.id = spl.user_id
    WHERE p.email = 'ta-prov@example.com'),
  0, 'no provisioning row is keyed on the profiles.id PK');

-- 3. Granting admin enqueues an admin_user row, also keyed on the auth uid.
INSERT INTO public.user_roles (user_id, role)
VALUES ('0a1b2c3d-0000-0000-0000-000000000001', 'admin'::public.app_role)
ON CONFLICT DO NOTHING;
SELECT is(
  (SELECT count(*)::int
     FROM public.support_provisioning_log spl
     JOIN public.profiles p ON p.user_id = spl.user_id
    WHERE p.email = 'ta-prov@example.com' AND spl.kind = 'admin_user'),
  1, 'admin provisioning is enqueued keyed on the auth uid');

-- 4. The data-repair converts a legacy row that holds a profiles.id to the uid.
--    Insert a legacy-style row (user_id = profiles.id), then run the same guarded
--    repair the migration performs, and assert it now holds the auth uid.
INSERT INTO public.support_provisioning_log (user_id, kind, status, attempts)
SELECT p.id, 'customer', 'retry', 0
  FROM public.profiles p WHERE p.email = 'ta-prov@example.com';

ALTER TABLE public.support_provisioning_log DISABLE TRIGGER trg_support_prov_log_no_update;
UPDATE public.support_provisioning_log spl
   SET user_id = p.user_id
  FROM public.profiles p
 WHERE spl.user_id = p.id AND spl.user_id <> p.user_id;
ALTER TABLE public.support_provisioning_log ENABLE TRIGGER trg_support_prov_log_no_update;

SELECT is(
  (SELECT count(*)::int
     FROM public.support_provisioning_log spl
     JOIN public.profiles p ON p.id = spl.user_id
    WHERE p.email = 'ta-prov@example.com'),
  0, 'data-repair leaves no row keyed on the profiles.id PK');

SELECT * FROM finish();
ROLLBACK;
