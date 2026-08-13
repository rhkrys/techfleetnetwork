-- pgTAP: guarded framework-source switch (Wave 6 cutover safety, Workstream A @release-safety).
-- Proves the ->spf cutover is REFUSED while the snapshot is empty/partial (the SEV1 blank-out
-- guard), succeeds once the snapshot is ready, and that rollback ->reference is always allowed.
-- Wrapped in a txn; rolls back — no persisted changes.
BEGIN;
SELECT plan(10);

SELECT has_function('public', 'framework_set_source', ARRAY['text','text'], 'guarded switch exists');
SELECT has_function('public', 'framework_spf_snapshot_ready', 'readiness signal exists');

-- Force a "no active snapshot" state within this txn (rolled back). Deactivate rather than DELETE
-- so no spf_edge FK is disturbed; the guard counts WHERE is_active, so this reads as empty.
UPDATE public.spf_entity SET is_active = false;

SELECT is(public.framework_spf_snapshot_ready(), false, 'empty snapshot is NOT ready');
SELECT throws_ok(
  $$ SELECT public.framework_set_source('spf') $$,
  '23514', NULL, 'activating SPF on an EMPTY snapshot is refused (blank-out guard)');

-- A single-type snapshot is still a partial sync — also refused. (Guard-prefixed slugs avoid any
-- collision with seed rows.)
INSERT INTO public.spf_entity (entity_type, slug, name, spf_version)
VALUES ('skill', 'zzguard-skill-a', 'Skill A', 'v1');
SELECT throws_ok(
  $$ SELECT public.framework_set_source('spf') $$,
  '23514', NULL, 'activating SPF on a 1-type partial snapshot is refused');

-- A broad snapshot (>= 3 entity types) is ready.
INSERT INTO public.spf_entity (entity_type, slug, name, spf_version) VALUES
  ('deliverable', 'zzguard-deliv-a', 'Deliverable A', 'v1'),
  ('workshop', 'zzguard-work-a', 'Workshop A', 'v1');
SELECT is(public.framework_spf_snapshot_ready(), true, 'a broad snapshot is ready');

SELECT is(public.framework_set_source('spf', 'v1'), 'spf', 'switch to SPF now succeeds');
SELECT is((SELECT active_source FROM public.framework_source_config WHERE id = 1), 'spf',
  'active_source is now spf');

-- Rollback is always allowed and instant.
SELECT is(public.framework_set_source('reference'), 'reference', 'rollback to reference is allowed');

SELECT throws_ok(
  $$ SELECT public.framework_set_source('bogus') $$,
  '22023', NULL, 'an invalid source is rejected');

SELECT * FROM finish();
ROLLBACK;
