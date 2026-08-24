-- pgTAP: DSAR EO contact delete (PR 8, ADR-0017). Run: `supabase test db`. Rolled back.
-- Proves: enqueue_eo_contact_delete queues a deleted/pending desired-state (and flips an existing
-- contact, bumping version); a synced delete PURGES the local row (no retained email for a deleted
-- user) while a non-delete sync is retained; the BEFORE DELETE trigger is installed; least privilege.

BEGIN;
SELECT plan(6);

-- Fresh contact → queued for deletion, lowercased.
SELECT public.enqueue_eo_contact_delete('Del-PgTAP@Example.com');
SELECT is(
  (SELECT desired_status || ':' || status FROM public.email_octopus_contact_sync WHERE email = 'del-pgtap@example.com'),
  'deleted:pending', 'enqueue_eo_contact_delete queues a deleted/pending row (lowercased)');

-- Existing subscribed contact → flipped to deleted, version bumped, re-queued.
INSERT INTO public.email_octopus_contact_sync (email, desired_status, version, status)
  VALUES ('sub-pgtap@example.com', 'subscribed', 3, 'synced');
SELECT public.enqueue_eo_contact_delete('sub-pgtap@example.com');
SELECT is(
  (SELECT desired_status || ':' || status || ':' || version FROM public.email_octopus_contact_sync WHERE email = 'sub-pgtap@example.com'),
  'deleted:pending:4', 'enqueue over an existing contact flips to deleted and bumps version');

-- A synced DELETE purges the local row (erasure completeness).
UPDATE public.email_octopus_contact_sync SET status = 'syncing' WHERE email = 'del-pgtap@example.com';
SELECT public.record_eo_sync_result('del-pgtap@example.com',
  (SELECT version FROM public.email_octopus_contact_sync WHERE email = 'del-pgtap@example.com'), 'synced', 200, NULL);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.email_octopus_contact_sync WHERE email = 'del-pgtap@example.com'),
  'a synced delete purges the local row (no retained email for a deleted user)');

-- A synced NON-delete row is retained (only deletes are purged).
INSERT INTO public.email_octopus_contact_sync (email, desired_status, version, status)
  VALUES ('keep-pgtap@example.com', 'unsubscribed', 1, 'syncing');
SELECT public.record_eo_sync_result('keep-pgtap@example.com', 1, 'synced', 200, NULL);
SELECT is(
  (SELECT status FROM public.email_octopus_contact_sync WHERE email = 'keep-pgtap@example.com'),
  'synced', 'a non-delete synced row is retained (only deletes are purged)');

-- The BEFORE DELETE trigger is installed on auth.users.
SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'eo_enqueue_contact_delete_before_user_delete' AND NOT tgisinternal),
  'the BEFORE DELETE trigger is installed on auth.users');

-- Least privilege: the delete-enqueue RPC is service-role only.
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.enqueue_eo_contact_delete(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.enqueue_eo_contact_delete(text)', 'EXECUTE'),
  'enqueue_eo_contact_delete is service-role only');

SELECT * FROM finish();
ROLLBACK;
