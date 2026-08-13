-- pgTAP: Hand-Off re-create budget + writer-only retry (Phase B2/B3 cost control).
-- Proves the team-wide cap (1 production + 1 retry), that a re-create is writer-only when a fact
-- base exists, and that the third self-service attempt is blocked. Wrapped in a txn; rolls back.
BEGIN;
SELECT plan(11);

SELECT has_table('public', 'handoff_run_budget', 'budget table exists');
SELECT has_table('public', 'handoff_fact_base', 'fact-base table exists');
SELECT has_function('public', 'handoff_enqueue_production', 'atomic enqueue RPC exists');
SELECT is(
  (SELECT bool_and(relrowsecurity) FROM pg_class
     WHERE relname IN ('handoff_run_budget','handoff_fact_base')),
  true, 'RLS enabled on the budget + fact-base tables');

-- Fixtures
INSERT INTO public.clients (id, name, created_by)
VALUES ('b2222222-2222-2222-2222-222222222222', 'Budget Client', 'b0000000-0000-0000-0000-000000000000');
INSERT INTO public.projects (id, client_id, project_type, created_by)
VALUES ('b3333333-3333-3333-3333-333333333333', 'b2222222-2222-2222-2222-222222222222', 'discovery',
        'b0000000-0000-0000-0000-000000000000');

-- Enqueue #1 = full production (no fact base yet).
SELECT is(
  (public.handoff_enqueue_production('b3333333-3333-3333-3333-333333333333','phase_1',
     'b0000000-0000-0000-0000-000000000000','v1','anthropic/claude-opus-4.8',NULL,NULL) ->> 'status'),
  'queued', 'first enqueue is queued');
SELECT is(
  (SELECT writer_only FROM public.handoff_productions
     WHERE project_id='b3333333-3333-3333-3333-333333333333' AND phase='phase_1'),
  false, 'the first run is a full production (not writer-only)');

-- While it is still running, a second enqueue is blocked by the one-active-run index (not the budget).
SELECT is(
  (public.handoff_enqueue_production('b3333333-3333-3333-3333-333333333333','phase_1',
     'b0000000-0000-0000-0000-000000000000','v1','anthropic/claude-opus-4.8',NULL,NULL) ->> 'status'),
  'in_progress', 'a second enqueue is refused while one run is in progress');

-- Complete the first run + persist a fact base, so the one allowed retry is WRITER-ONLY + scoped.
UPDATE public.handoff_productions SET status='complete'
  WHERE project_id='b3333333-3333-3333-3333-333333333333' AND phase='phase_1';
INSERT INTO public.handoff_fact_base (project_id, phase, facts)
VALUES ('b3333333-3333-3333-3333-333333333333','phase_1','[]'::jsonb);

SELECT is(
  (public.handoff_enqueue_production('b3333333-3333-3333-3333-333333333333','phase_1',
     'b0000000-0000-0000-0000-000000000000','v1','anthropic/claude-opus-4.8',NULL,
     ARRAY['org_case_study']) ->> 'status'),
  'queued', 'the one retry enqueues');
SELECT is(
  (SELECT writer_only FROM public.handoff_productions
     WHERE project_id='b3333333-3333-3333-3333-333333333333' AND phase='phase_1' AND status='queued'),
  true, 'the retry is writer-only (reuses the fact base)');

-- Spend the retry, then the third self-service attempt is blocked by the team budget.
UPDATE public.handoff_productions SET status='complete'
  WHERE project_id='b3333333-3333-3333-3333-333333333333' AND phase='phase_1' AND status='queued';
SELECT is(
  (public.handoff_enqueue_production('b3333333-3333-3333-3333-333333333333','phase_1',
     'b0000000-0000-0000-0000-000000000000','v1','anthropic/claude-opus-4.8',NULL,NULL) ->> 'status'),
  'budget_exceeded', 'the third self-service attempt is blocked by the budget');
SELECT is(
  (SELECT runs_used FROM public.handoff_run_budget
     WHERE project_id='b3333333-3333-3333-3333-333333333333' AND phase='phase_1'), 2,
  'exactly 2 runs were charged to the team budget');

SELECT * FROM finish();
ROLLBACK;
