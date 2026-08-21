-- pgTAP: reconcile_stuck_emails() re-queues stuck legacy messages into the v2 outbox (PR 2).
-- Run: `supabase test db` against a migrated DB. Rolled back at the end.
-- Proves the reshape in 20260820120000_email_triggers_to_v2.sql: a stuck LEGACY message (pending,
-- no email_outbox row, fresh payload) is re-queued via enqueue_email_v2 into email_outbox (the live
-- v2 pipeline), NOT re-sent to the retired raw pgmq queue.

BEGIN;
SELECT plan(2);

-- A stuck legacy pending row: >10 min old, no email_outbox row, with a fresh queue_payload so the
-- reconciler's requeue branch (not the DLQ branch) fires.
INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, created_at, metadata)
VALUES (
  'pgtap-recon-1',
  'project_opening_alert',
  'recon@example.com',
  'pending',
  now() - interval '20 minutes',
  jsonb_build_object(
    'queue_name', 'transactional_emails',
    'queue_payload', jsonb_build_object(
      'to', 'recon@example.com',
      'subject', 'Recon Test',
      'html', '<p>x</p>',
      'label', 'project_opening_alert',
      'message_id', 'pgtap-recon-1',
      'idempotency_key', 'pgtap-recon-1',
      'queued_at', now()::text
    )
  )
);

DO $$ BEGIN PERFORM public.reconcile_stuck_emails(); END $$;

SELECT ok(
  EXISTS (SELECT 1 FROM public.email_outbox WHERE message_id = 'pgtap-recon-1'),
  'reconciler re-queues a stuck legacy message into the v2 outbox (not the dead pgmq queue)');

SELECT is(
  (SELECT lane FROM public.email_outbox WHERE message_id = 'pgtap-recon-1'),
  'transactional',
  'the requeued message lands on the lane mapped from its queue_name');

SELECT * FROM finish();
ROLLBACK;
