-- pgTAP suite for A4 graph-aware retrieval (fw_graph_context) + its two enabling DB fixes.
-- Run: `supabase db test` (CI-pinned CLI) against a DB with the migrations applied. All in a
-- rolled-back transaction. Seeds its own spf_entity/framework_edges fixtures (a migrated-only DB
-- has no ingested data) and flips active_source='spf' so framework_entity_v serves them.
--
-- Guards: (1) fw_graph_context is least-privilege (service_role only) + search_path-pinned;
-- (2) it caps neighbors per direction, ranks by goal relevance, and returns narrative-only data
-- (relationship arrays stay as edges); (3) framework_search_mv reads the SPF facade (the repoint
-- that revived graph injection); (4) the edge map covers career_transition (the coverage extension).

BEGIN;
SELECT plan(13);

-- ── Security ─────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT prosecdef FROM pg_proc
     WHERE oid = 'public.fw_graph_context(text,jsonb,integer)'::regprocedure),
  true, 'fw_graph_context is SECURITY DEFINER');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proconfig) AS c
    WHERE p.oid = 'public.fw_graph_context(text,jsonb,integer)'::regprocedure
      AND c LIKE 'search_path=%'),
  'fw_graph_context pins search_path (needs public+extensions for pg_trgm)');

SELECT ok(NOT has_function_privilege('anon',
  'public.fw_graph_context(text,jsonb,integer)', 'EXECUTE'),
  'anon cannot EXECUTE fw_graph_context');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.fw_graph_context(text,jsonb,integer)', 'EXECUTE'),
  'authenticated cannot EXECUTE fw_graph_context');
SELECT ok(has_function_privilege('service_role',
  'public.fw_graph_context(text,jsonb,integer)', 'EXECUTE'),
  'service_role CAN EXECUTE fw_graph_context');

-- ── Fixtures: 1 duty anchor -> 3 skills, with array + scalar data fields ───────
UPDATE public.framework_source_config SET active_source = 'spf' WHERE id = 1;

INSERT INTO public.spf_entity (entity_type, id, slug, name, description, data, is_active, spf_version) VALUES
  ('duty',  'aaaaaaaa-0000-0000-0000-000000000001', 'ux-research-duty', 'UX Research', 'Runs discovery.',
     '{"Duty Name":"UX Research","Some Skills":[{"slug":"x","label":"X"}]}'::jsonb, true, 'v1'),
  ('skill', 'aaaaaaaa-0000-0000-0000-000000000002', 'usability-testing', 'Usability Testing', 'Test with users.',
     '{"Skill Name":"Usability Testing","Practices":[{"slug":"p","label":"P"}]}'::jsonb, true, 'v1'),
  ('skill', 'aaaaaaaa-0000-0000-0000-000000000003', 'interviewing', 'Interviewing', 'Talk to users.',
     '{"Skill Name":"Interviewing"}'::jsonb, true, 'v1'),
  ('skill', 'aaaaaaaa-0000-0000-0000-000000000004', 'survey-design', 'Survey Design', 'Design surveys.',
     '{"Skill Name":"Survey Design"}'::jsonb, true, 'v1');

INSERT INTO public.framework_edges (src_type, src_id, rel_type, dst_type, dst_id, weight, source) VALUES
  ('duty','aaaaaaaa-0000-0000-0000-000000000001','requires_skill','skill','aaaaaaaa-0000-0000-0000-000000000002',1,'spf'),
  ('duty','aaaaaaaa-0000-0000-0000-000000000001','requires_skill','skill','aaaaaaaa-0000-0000-0000-000000000003',1,'spf'),
  ('duty','aaaaaaaa-0000-0000-0000-000000000001','requires_skill','skill','aaaaaaaa-0000-0000-0000-000000000004',1,'spf');

CREATE TEMP TABLE gctx AS
  SELECT public.fw_graph_context(
    'usability testing',
    '[{"type":"duty","id":"aaaaaaaa-0000-0000-0000-000000000001"}]'::jsonb,
    2
  ) AS j;

-- ── Behavior ───────────────────────────────────────────────────────────────
SELECT is(
  (SELECT j -> 'duty:aaaaaaaa-0000-0000-0000-000000000001' -> 'anchor' ->> 'name' FROM gctx),
  'UX Research', 'anchor resolves with its name');

SELECT is(
  (SELECT jsonb_array_length(j -> 'duty:aaaaaaaa-0000-0000-0000-000000000001' -> 'neighbors') FROM gctx),
  2, 'neighbors capped at p_per_dir (2), not all 3 out-edges');

SELECT is(
  (SELECT j -> 'duty:aaaaaaaa-0000-0000-0000-000000000001' -> 'neighbors' -> 0 ->> 'name' FROM gctx),
  'Usability Testing', 'top-ranked neighbor is the one most relevant to the goal query');

SELECT ok(
  (SELECT (j -> 'duty:aaaaaaaa-0000-0000-0000-000000000001' -> 'neighbors' -> 0 -> 'data') ? 'Skill Name' FROM gctx),
  'neighbor data keeps scalar narrative fields (Skill Name)');

SELECT ok(
  NOT (SELECT (j -> 'duty:aaaaaaaa-0000-0000-0000-000000000001' -> 'neighbors' -> 0 -> 'data') ? 'Practices' FROM gctx),
  'neighbor data drops {slug,label} relationship arrays (they are edges, not data)');

SELECT ok(
  NOT (SELECT (j -> 'duty:aaaaaaaa-0000-0000-0000-000000000001' -> 'anchor' -> 'data') ? 'Some Skills' FROM gctx),
  'anchor data is narrative-only too (array field stripped)');

-- ── Regression guards for the two enabling fixes ───────────────────────────────
SELECT ok(
  (SELECT definition FROM pg_matviews WHERE matviewname = 'framework_search_mv') LIKE '%framework_entity_v%',
  'framework_search_mv reads the SPF facade (repoint that revived graph injection)');

SELECT cmp_ok(
  (SELECT count(*)::int FROM public.spf_edge_map WHERE src_entity_type = 'career_transition'),
  '>', 0,
  'spf_edge_map covers career_transition (edge-map coverage extension)');

SELECT * FROM finish();
ROLLBACK;
