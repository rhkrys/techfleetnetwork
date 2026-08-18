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
SELECT plan(19);

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
     '{"Skill Name":"Survey Design"}'::jsonb, true, 'v1'),
  -- deliverables (a SECOND neighbor type): these must NOT be crowded out of the skill slots.
  ('deliverable', 'aaaaaaaa-0000-0000-0000-000000000012', 'research-plan', 'Research Plan', 'Plan the study.',
     '{"Deliverable Name":"Research Plan"}'::jsonb, true, 'v1'),
  ('deliverable', 'aaaaaaaa-0000-0000-0000-000000000013', 'research-report', 'Research Report', 'Report findings.',
     '{"Deliverable Name":"Research Report"}'::jsonb, true, 'v1'),
  ('deliverable', 'aaaaaaaa-0000-0000-0000-000000000014', 'research-analysis', 'Research Analysis', 'Analyze data.',
     '{"Deliverable Name":"Research Analysis"}'::jsonb, true, 'v1');

INSERT INTO public.framework_edges (src_type, src_id, rel_type, dst_type, dst_id, weight, source) VALUES
  ('duty','aaaaaaaa-0000-0000-0000-000000000001','requires_skill','skill','aaaaaaaa-0000-0000-0000-000000000002',1,'spf'),
  ('duty','aaaaaaaa-0000-0000-0000-000000000001','requires_skill','skill','aaaaaaaa-0000-0000-0000-000000000003',1,'spf'),
  ('duty','aaaaaaaa-0000-0000-0000-000000000001','requires_skill','skill','aaaaaaaa-0000-0000-0000-000000000004',1,'spf'),
  ('duty','aaaaaaaa-0000-0000-0000-000000000001','produces','deliverable','aaaaaaaa-0000-0000-0000-000000000012',1,'spf'),
  ('duty','aaaaaaaa-0000-0000-0000-000000000001','produces','deliverable','aaaaaaaa-0000-0000-0000-000000000013',1,'spf'),
  ('duty','aaaaaaaa-0000-0000-0000-000000000001','produces','deliverable','aaaaaaaa-0000-0000-0000-000000000014',1,'spf');

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

-- Per-type quota: p_per_type=2 keeps 2 skills AND 2 deliverables = 4 total (NOT 2 shared) — the fix
-- for the miss where 6 shared out-slots let skills crowd out the milestone's research deliverables.
SELECT is(
  (SELECT jsonb_array_length(j -> 'duty:aaaaaaaa-0000-0000-0000-000000000001' -> 'neighbors') FROM gctx),
  4, 'per-type quota keeps 2 skills + 2 deliverables = 4, not one shared cap of 2');

SELECT is(
  (SELECT count(*)::int
     FROM gctx, jsonb_array_elements(gctx.j -> 'duty:aaaaaaaa-0000-0000-0000-000000000001' -> 'neighbors') AS n
    WHERE n->>'type' = 'skill'),
  2, 'skills capped at p_per_type (2)');

SELECT is(
  (SELECT count(*)::int
     FROM gctx, jsonb_array_elements(gctx.j -> 'duty:aaaaaaaa-0000-0000-0000-000000000001' -> 'neighbors') AS n
    WHERE n->>'type' = 'deliverable'),
  2, 'deliverables get their OWN quota (not crowded out by skills) — the per-type fix');

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

-- ── Fleety 2.0 relational-intelligence guards (weights + RACI + precise relations) ──
SELECT ok(
  'responsible' = ANY (enum_range(NULL::public.framework_rel_type)::text[])
  AND 'consulted' = ANY (enum_range(NULL::public.framework_rel_type)::text[]),
  'RACI relation types (responsible/consulted) exist in framework_rel_type');

SELECT ok(
  'foundational_skill' = ANY (enum_range(NULL::public.framework_rel_type)::text[])
  AND 'learns_tool' = ANY (enum_range(NULL::public.framework_rel_type)::text[])
  AND 'delivered_in' = ANY (enum_range(NULL::public.framework_rel_type)::text[]),
  'precise "true" relations (foundational_skill/learns_tool/delivered_in) exist');

SELECT ok(
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='spf_edge_map' AND column_name='weight'),
  'spf_edge_map has the foundational-importance weight column');

SELECT cmp_ok(
  (SELECT count(*)::int FROM public.spf_edge_map WHERE weight > 1),
  '>', 0,
  'importance weights are applied (foundational/required/UNIQUE/ownership/RACI fields > 1)');

SELECT * FROM finish();
ROLLBACK;
