-- pgTAP: Hand-Off "ready to review" notification (Phase B3 @reliability).
-- Completing a run notifies the person who started it (async delivery — they're not on-screen).
-- Txn-wrapped; rolls back.
BEGIN;
SELECT plan(4);

SELECT has_function('public', 'handoff_complete_run', ARRAY['uuid','text','integer'],
  'completion RPC exists');

-- Fixtures: a run owned by a worker, ready to complete, started by user n0.
INSERT INTO public.clients (id, name, created_by)
VALUES ('d2222222-2222-2222-2222-222222222222', 'Notify Client', 'd0000000-0000-0000-0000-000000000000');
INSERT INTO public.projects (id, client_id, project_type, created_by)
VALUES ('d1111111-1111-1111-1111-111111111111', 'd2222222-2222-2222-2222-222222222222', 'discovery',
        'd0000000-0000-0000-0000-000000000000');
INSERT INTO public.handoff_productions (id, project_id, phase, triggered_by, status, worker_id)
VALUES ('d4444444-4444-4444-4444-444444444444', 'd1111111-1111-1111-1111-111111111111', 'phase_1',
        'd0000000-0000-0000-0000-000000000000', 'writing', 'worker-under-test');

SELECT is(public.handoff_complete_run('d4444444-4444-4444-4444-444444444444', 'worker-under-test', 0),
  true, 'the run completes');
SELECT is((SELECT status FROM public.handoff_productions WHERE id='d4444444-4444-4444-4444-444444444444'),
  'complete', 'status is complete');
SELECT is(
  (SELECT count(*)::int FROM public.notification_outbox
     WHERE user_id = 'd0000000-0000-0000-0000-000000000000'
       AND title LIKE 'Your hand-offs are ready%'),
  1, 'the initiator gets a "ready to review" notification');

SELECT * FROM finish();
ROLLBACK;
