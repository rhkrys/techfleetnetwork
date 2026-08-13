-- pgTAP: Hand-Off feedback RLS/IDOR (Phase B3 @security).
-- A member rates their own project's run; a member of a different project cannot read or write it;
-- created_by cannot be forged; one rating per (run, version, person). Txn-wrapped; rolls back.
BEGIN;
SELECT plan(8);

SELECT has_table('public', 'handoff_feedback', 'feedback table exists');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='handoff_feedback'), true,
  'RLS enabled on handoff_feedback');

-- Fixtures: user_a active on A, user_b active on B; a completed run on A.
INSERT INTO public.clients (id, name, created_by)
VALUES ('f2222222-2222-2222-2222-222222222222', 'FB Client', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO public.projects (id, client_id, project_type, created_by) VALUES
  ('f1111111-1111-1111-1111-111111111111', 'f2222222-2222-2222-2222-222222222222', 'discovery', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('f2221111-1111-1111-1111-111111111111', 'f2222222-2222-2222-2222-222222222222', 'discovery', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO public.project_applications (user_id, project_id, applicant_status) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f1111111-1111-1111-1111-111111111111', 'active_participant'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'f2221111-1111-1111-1111-111111111111', 'active_participant');
INSERT INTO public.handoff_productions (id, project_id, phase, triggered_by, status)
VALUES ('f4444444-4444-4444-4444-444444444444', 'f1111111-1111-1111-1111-111111111111', 'phase_1',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'complete');

-- As user_a (active on A): can rate A's run, and read it back.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
SELECT lives_ok($$
  INSERT INTO public.handoff_feedback (production_id, audience, rating, note)
  VALUES ('f4444444-4444-4444-4444-444444444444', 'client', 'up', 'reads well') $$,
  'an active member can rate their run''s version');
SELECT is((SELECT count(*)::int FROM public.handoff_feedback
  WHERE production_id = 'f4444444-4444-4444-4444-444444444444'), 1, 'and read it back');
SELECT throws_ok($$
  INSERT INTO public.handoff_feedback (production_id, audience, rating, created_by)
  VALUES ('f4444444-4444-4444-4444-444444444444', 'teammate', 'up', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') $$,
  '42501', NULL, 'forging created_by to another user is blocked');
SELECT throws_ok($$
  INSERT INTO public.handoff_feedback (production_id, audience, rating)
  VALUES ('f4444444-4444-4444-4444-444444444444', 'client', 'down') $$,
  '23505', NULL, 'one rating per (run, version, person) — duplicate is rejected');
RESET ROLE;

-- As user_b (active on B only): cannot read or write A's feedback (cross-project IDOR).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
SELECT is((SELECT count(*)::int FROM public.handoff_feedback
  WHERE production_id = 'f4444444-4444-4444-4444-444444444444'), 0,
  'IDOR: a non-member cannot read another project''s feedback');
SELECT throws_ok($$
  INSERT INTO public.handoff_feedback (production_id, audience, rating)
  VALUES ('f4444444-4444-4444-4444-444444444444', 'teammate', 'up') $$,
  '42501', NULL, 'IDOR: a non-member cannot rate another project''s run');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
