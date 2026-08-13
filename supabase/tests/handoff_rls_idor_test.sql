-- pgTAP: Hand-Off store RLS / IDOR (Phase B1/B2 @security).
-- Proves the deny-by-default access model on the three Restricted hand-off tables: an active
-- teammate reads ONLY their own project's submissions, runs, and output files; a teammate on a
-- DIFFERENT project reads none of them (the core cross-project IDOR the threat model calls T6);
-- and the insert path is mass-assignment safe (created_by cannot be forged, and a non-member
-- cannot write to a project). Also locks the reliability migration (gap_count + the 3-arg
-- handoff_complete_run). Wrapped in a txn; rolls back — no persisted changes.
BEGIN;
SELECT plan(20);

-- ── Fixtures (as superuser; RLS bypassed for setup) ──────────────────────────
-- Two users, two projects under one client. user_a is active on A only; user_b on B only.
INSERT INTO public.clients (id, name, created_by)
VALUES ('33333333-3333-3333-3333-333333333333', 'Test Client',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO public.projects (id, client_id, project_type, created_by) VALUES
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'discovery',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'discovery',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO public.project_applications (user_id, project_id, applicant_status) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'active_participant'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'active_participant');

-- One submission per project (created_by set explicitly: as superuser auth.uid() is NULL).
INSERT INTO public.handoff_deliverable_submissions
  (project_id, phase, component_slug, submission_type, text_content, created_by) VALUES
  ('11111111-1111-1111-1111-111111111111', 'phase_1', 'pre-amble-4', 'text', 'A work', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('22222222-2222-2222-2222-222222222222', 'phase_1', 'pre-amble-4', 'text', 'B work', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- One production per project; one output file for A's run only.
INSERT INTO public.handoff_productions (id, project_id, phase, triggered_by) VALUES
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'phase_1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'phase_1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
INSERT INTO public.handoff_output_files (production_id, audience, format, storage_path) VALUES
  ('44444444-4444-4444-4444-444444444444', 'client', 'md', '11111111-1111-1111-1111-111111111111/phase_1/44444444-4444-4444-4444-444444444444/client.md');

-- ── Schema + RLS present ──────────────────────────────────────────────────────
SELECT has_table('public', 'handoff_deliverable_submissions', 'submissions table exists');
SELECT has_table('public', 'handoff_productions', 'productions table exists');
SELECT has_table('public', 'handoff_output_files', 'output_files table exists');
SELECT is(
  (SELECT bool_and(relrowsecurity) FROM pg_class
     WHERE relname IN ('handoff_deliverable_submissions','handoff_productions','handoff_output_files')),
  true, 'RLS enabled on all three hand-off tables');
SELECT has_function('public', 'handoff_is_active_member', ARRAY['uuid'], 'membership helper exists');

-- ── Reliability migration locked (gap_count + 3-arg complete RPC) ─────────────
SELECT has_column('public', 'handoff_productions', 'gap_count', 'gap_count column exists');
SELECT col_default_is('public', 'handoff_productions', 'gap_count', '0', 'gap_count defaults to 0');
SELECT has_function('public', 'handoff_complete_run', ARRAY['uuid','text','integer'],
  'handoff_complete_run takes the trailing p_gap_count');

-- ── As user_a (active on project A) ──────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

SELECT is(public.handoff_is_active_member('11111111-1111-1111-1111-111111111111'), true,
  'user_a is an active member of A');
SELECT is(public.handoff_is_active_member('22222222-2222-2222-2222-222222222222'), false,
  'user_a is NOT a member of B');
SELECT is((SELECT count(*)::int FROM public.handoff_deliverable_submissions
  WHERE project_id = '11111111-1111-1111-1111-111111111111'), 1,
  'user_a reads their own project submission');
SELECT is((SELECT count(*)::int FROM public.handoff_deliverable_submissions
  WHERE project_id = '22222222-2222-2222-2222-222222222222'), 0,
  'IDOR: user_a cannot read project B submissions');
SELECT is((SELECT count(*)::int FROM public.handoff_productions
  WHERE project_id = '22222222-2222-2222-2222-222222222222'), 0,
  'IDOR: user_a cannot read project B runs');
SELECT is((SELECT count(*)::int FROM public.handoff_output_files
  WHERE production_id = '44444444-4444-4444-4444-444444444444'), 1,
  'user_a reads their own run''s output file');

-- Mass-assignment: created_by cannot be forged, and a non-member cannot write to a project.
SELECT throws_ok($$
  INSERT INTO public.handoff_deliverable_submissions
    (project_id, phase, component_slug, submission_type, text_content, created_by)
  VALUES ('11111111-1111-1111-1111-111111111111','phase_1','pre-amble-4','text','forged',
          'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') $$,
  '42501', NULL, 'forging created_by to another user is blocked by RLS');
SELECT throws_ok($$
  INSERT INTO public.handoff_deliverable_submissions
    (project_id, phase, component_slug, submission_type, text_content)
  VALUES ('22222222-2222-2222-2222-222222222222','phase_1','pre-amble-4','text','intruder') $$,
  '42501', NULL, 'a non-member cannot write to another project');
SELECT lives_ok($$
  INSERT INTO public.handoff_deliverable_submissions
    (project_id, phase, component_slug, submission_type, text_content)
  VALUES ('11111111-1111-1111-1111-111111111111','phase_1','part-1-empathy-building-2','text','my own work') $$,
  'a member''s own submission (created_by defaults to self) is allowed');

RESET ROLE;

-- ── As user_b (active on project B) — the mirror IDOR direction ───────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';

SELECT is((SELECT count(*)::int FROM public.handoff_deliverable_submissions
  WHERE project_id = '11111111-1111-1111-1111-111111111111'), 0,
  'IDOR: user_b cannot read project A submissions');
SELECT is((SELECT count(*)::int FROM public.handoff_productions
  WHERE project_id = '11111111-1111-1111-1111-111111111111'), 0,
  'IDOR: user_b cannot read project A runs');
SELECT is((SELECT count(*)::int FROM public.handoff_output_files
  WHERE production_id = '44444444-4444-4444-4444-444444444444'), 0,
  'IDOR: user_b cannot read project A output files (the T6 signed-URL-precondition)');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
