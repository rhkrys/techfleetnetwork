-- pgTAP: Hand-Off DSAR erasure + retention (Wave 4 @compliance / @data-lifecycle).
-- Proves (1) account deletion (the auth.users erasure entrypoint) propagates to the departing
-- user's hand-off submissions, and (2) the retention prune removes superseded old versions while
-- keeping the latest. Wrapped in a txn; rolls back — no persisted changes.
BEGIN;
SELECT plan(9);

SELECT has_function('public', 'prune_handoff_productions', ARRAY['integer'],
  'retention prune function exists');

-- ── Retention: keep latest, prune aged non-latest ───────────────────────────
INSERT INTO public.clients (id, name, created_by)
VALUES ('e2222222-2222-2222-2222-222222222222', 'Retention Client',
        'e0000000-0000-0000-0000-000000000000');
INSERT INTO public.projects (id, client_id, project_type, created_by)
VALUES ('e3333333-3333-3333-3333-333333333333', 'e2222222-2222-2222-2222-222222222222',
        'discovery', 'e0000000-0000-0000-0000-000000000000');
-- One current (latest) run + one superseded run created 400 days ago.
INSERT INTO public.handoff_productions (id, project_id, phase, triggered_by, is_latest, status, created_at) VALUES
  ('e4444444-4444-4444-4444-444444444444', 'e3333333-3333-3333-3333-333333333333', 'phase_1',
   'e0000000-0000-0000-0000-000000000000', true,  'complete', now()),
  ('e5555555-5555-5555-5555-555555555555', 'e3333333-3333-3333-3333-333333333333', 'phase_1',
   'e0000000-0000-0000-0000-000000000000', false, 'complete', now() - interval '400 days');

SELECT is((SELECT count(*)::int FROM public.handoff_productions
  WHERE project_id = 'e3333333-3333-3333-3333-333333333333'), 2, 'precondition: 2 runs exist');
SELECT is(public.prune_handoff_productions(365), 1, 'prune removes exactly the one aged non-latest run');
SELECT is((SELECT count(*)::int FROM public.handoff_productions
  WHERE id = 'e5555555-5555-5555-5555-555555555555'), 0, 'the aged superseded run is pruned');
SELECT is((SELECT count(*)::int FROM public.handoff_productions
  WHERE id = 'e4444444-4444-4444-4444-444444444444'), 1, 'the latest run is kept (retained indefinitely)');

-- ── DSAR erasure: deleting the auth user removes their submissions ───────────
INSERT INTO auth.users (id, email)
VALUES ('e1111111-1111-1111-1111-111111111111', 'handoff-erase@example.com')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (user_id, email, display_name)
VALUES ('e1111111-1111-1111-1111-111111111111', 'handoff-erase@example.com', 'Erase Me')
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.handoff_deliverable_submissions
  (project_id, phase, component_slug, submission_type, text_content, created_by)
VALUES ('e3333333-3333-3333-3333-333333333333', 'phase_1', 'pre-amble-4', 'text',
        'my private reflection', 'e1111111-1111-1111-1111-111111111111');

SELECT is((SELECT count(*)::int FROM public.handoff_deliverable_submissions
  WHERE created_by = 'e1111111-1111-1111-1111-111111111111'), 1,
  'precondition: the user has a hand-off submission');

SELECT lives_ok($$ DELETE FROM auth.users WHERE id = 'e1111111-1111-1111-1111-111111111111' $$,
  'account deletion (the erasure entrypoint) completes');

SELECT is((SELECT count(*)::int FROM public.handoff_deliverable_submissions
  WHERE created_by = 'e1111111-1111-1111-1111-111111111111'), 0,
  'DSAR: the erased user''s hand-off submissions are gone');
SELECT is((SELECT count(*)::int FROM auth.users
  WHERE id = 'e1111111-1111-1111-1111-111111111111'), 0, 'the auth user is fully removed');

SELECT * FROM finish();
ROLLBACK;
