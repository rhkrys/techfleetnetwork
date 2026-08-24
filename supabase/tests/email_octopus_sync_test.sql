-- pgTAP: Email Octopus desired-state sync (PR 6a, ADR-0017). Run: `supabase test db`. Rolled back.
-- Proves: (1) the member intent RPC is self-only via auth.uid(), and the read RPC reports state;
-- (2) re-opting bumps version and re-queues even after DLQ; (3) the worker settle honors optimistic
-- concurrency (a stale version never marks synced); (4) the table is deny-all to anon/authenticated
-- and the worker RPCs are service-role only.

BEGIN;
SELECT plan(12);

-- Fixtures: one member with a mixed-case email (the RPC must lowercase it into the EO key).
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'eo-pgtap@example.com')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (user_id, email, first_name) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'EO-PgTAP@Example.com', 'Ada')
ON CONFLICT (user_id) DO UPDATE SET email = 'EO-PgTAP@Example.com', first_name = 'Ada';

-- Act as that authenticated member (auth.uid()). Set both GUC shapes Supabase's auth.uid() may read.
SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- (1) Opt in at signup.
SELECT lives_ok(
  $$ SELECT public.set_my_marketing_subscription(true, 'signup') $$,
  'member can opt in (self-only RPC, no email parameter)');

SELECT is(
  (SELECT desired_status FROM public.email_octopus_contact_sync WHERE email = 'eo-pgtap@example.com'),
  'subscribed', 'opt-in records desired_status=subscribed under the lowercased email');
SELECT is(
  (SELECT status FROM public.email_octopus_contact_sync WHERE email = 'eo-pgtap@example.com'),
  'pending', 'opt-in leaves the row pending for the worker');
SELECT is(
  (SELECT version FROM public.email_octopus_contact_sync WHERE email = 'eo-pgtap@example.com'),
  1::bigint, 'first intent is version 1');
SELECT is(
  (SELECT fields->>'first_name' FROM public.email_octopus_contact_sync WHERE email = 'eo-pgtap@example.com'),
  'Ada', 'personalization captured from the profile');
SELECT is(
  public.get_my_marketing_subscription(), 'subscribed',
  'the self-only read RPC reports the caller''s current desired state (drives the toggle, no profiles receipt)');

-- Simulate the row having gone to DLQ, then the member opts OUT: must re-queue with a bumped version.
UPDATE public.email_octopus_contact_sync
   SET status = 'dlq', attempts = 8, dlq_reason = 'max_attempts'
 WHERE email = 'eo-pgtap@example.com';
SELECT lives_ok(
  $$ SELECT public.set_my_marketing_subscription(false, 'profile') $$,
  'member can opt out');
SELECT is(
  (SELECT desired_status || ':' || status || ':' || version || ':' || attempts
     FROM public.email_octopus_contact_sync WHERE email = 'eo-pgtap@example.com'),
  'unsubscribed:pending:2:0',
  're-opting bumps version to 2, re-queues (pending), and resets attempts even from DLQ');
SELECT is(
  public.get_my_marketing_subscription(), 'unsubscribed',
  'the read RPC reflects the latest intent after opt-out');

-- (3) Optimistic concurrency: settle with a STALE version must not mark synced.
UPDATE public.email_octopus_contact_sync SET status = 'syncing' WHERE email = 'eo-pgtap@example.com';
SELECT public.record_eo_sync_result('eo-pgtap@example.com', 1, 'synced', 200, NULL);  -- stale (current=2)
SELECT is(
  (SELECT status FROM public.email_octopus_contact_sync WHERE email = 'eo-pgtap@example.com'),
  'pending', 'a stale-version settle re-queues instead of marking synced (newer intent wins)');

-- Settle with the CURRENT version marks synced.
UPDATE public.email_octopus_contact_sync SET status = 'syncing' WHERE email = 'eo-pgtap@example.com';
SELECT public.record_eo_sync_result('eo-pgtap@example.com', 2, 'synced', 200, NULL);
SELECT is(
  (SELECT status || ':' || synced_version
     FROM public.email_octopus_contact_sync WHERE email = 'eo-pgtap@example.com'),
  'synced:2', 'settle with the current version marks synced and records synced_version');

-- (4) Least privilege: worker RPCs are service-role only; the table is deny-all to members.
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.claim_eo_sync(integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.set_my_marketing_subscription(boolean, text)', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'public.email_octopus_contact_sync', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.email_octopus_contact_sync', 'SELECT'),
  'worker RPCs are service-role only; the sync table is deny-all to anon/authenticated');

SELECT * FROM finish();
ROLLBACK;
