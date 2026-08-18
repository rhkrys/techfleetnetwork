-- pgTAP: SPF snapshot expand + atomic-swap RPC (Phase A1; ADR-0002).
-- Run: supabase db test  (or pg_prove). Wrapped in a txn; rolls back — no persisted changes.
BEGIN;
SELECT plan(17);

-- ── Schema exists ────────────────────────────────────────────────────────────
SELECT has_table('public', 'spf_entity', 'spf_entity exists');
SELECT has_table('public', 'spf_datasets_raw', 'spf_datasets_raw exists');
SELECT has_table('public', 'framework_source_config', 'framework_source_config exists');
SELECT has_table('public', 'spf_project_type_map', 'spf_project_type_map exists');
SELECT has_table('public', 'spf_project_phase_map', 'spf_project_phase_map exists');
SELECT has_function('public', 'spf_apply_dataset', 'atomic-swap RPC exists');

-- ── spf_entity mirrors the framework_entity_v 9-col contract (+ spf_version, + search_tsv) ──
-- search_tsv is a STORED generated column (precomputed FTS vector, derived from name+description) added
-- for fw_graph_context ranking perf (migration 20260817230000) — not part of the swap payload.
SELECT columns_are(
  'public', 'spf_entity',
  ARRAY['entity_type','id','slug','name','description','category','data','is_active','updated_at','spf_version','search_tsv'],
  'spf_entity has exactly the snapshot columns'
);

-- ── Source toggle defaults to the OLD source (fail-safe) ─────────────────────
SELECT is(
  (SELECT active_source FROM public.framework_source_config WHERE id = 1),
  'reference',
  'framework source defaults to reference (fail-safe)'
);
SELECT is((SELECT count(*) FROM public.framework_source_config)::int, 1, 'config is a singleton');

-- ── Crosswalks: no fabricated mapping ────────────────────────────────────────
SELECT is((SELECT count(*) FROM public.spf_project_type_map)::int, 5, 'all 5 local project types listed');
SELECT is(
  (SELECT spf_slug FROM public.spf_project_type_map WHERE local_project_type = 'strategy'),
  NULL,
  'strategy is left unmapped (NULL), not fabricated'
);
SELECT is((SELECT count(*) FROM public.spf_project_phase_map)::int, 4, 'all 4 phases mapped');

-- ── RLS is enabled on the snapshot tables ────────────────────────────────────
SELECT is(
  (SELECT bool_and(relrowsecurity) FROM pg_class
     WHERE relname IN ('spf_entity','spf_datasets_raw','framework_source_config')),
  true,
  'RLS enabled on snapshot + config tables'
);

-- ── Atomic swap: apply then re-apply replaces (not appends) ──────────────────
SELECT lives_ok($$
  SELECT public.spf_apply_dataset('t_type','t-ds','v1','ck1',2,'[]'::jsonb,
    '[{"slug":"a","name":"A","data":{}},{"slug":"b","name":"B","data":{}}]'::jsonb)
$$, 'first apply inserts 2 rows');
SELECT is((SELECT count(*) FROM public.spf_entity WHERE entity_type='t_type')::int, 2,
  'entity_type has 2 rows after first apply');

SELECT lives_ok($$
  SELECT public.spf_apply_dataset('t_type','t-ds','v1','ck2',1,'[]'::jsonb,
    '[{"slug":"c","name":"C","data":{}}]'::jsonb)
$$, 're-apply with a different snapshot');
SELECT is((SELECT string_agg(slug, ',') FROM public.spf_entity WHERE entity_type='t_type'),
  'c',
  'swap REPLACED the snapshot (old rows gone, not appended)');

SELECT * FROM finish();
ROLLBACK;
