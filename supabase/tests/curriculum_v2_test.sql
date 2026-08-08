-- pgTAP suite for Class Curriculum Authoring v2 (files/links + release engine).
-- Run: `supabase db test` (or pg_prove) against a DB with the migrations applied.
-- Proves the SECURITY properties by actually attacking them as each role:
-- owner-teacher, un-approved owner, other teacher, admin, entitled learner,
-- and an unrelated outsider. Everything runs in a rolled-back transaction.

BEGIN;
SELECT plan(26);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- Disable validation/slug triggers for deterministic setup; FKs are all valid.
SET session_replication_role = replica;

-- Users: T=owner-teacher, O=other-teacher, L=entitled learner, A=admin, X=outsider.
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'teacher@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'other-teacher@example.com'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'learner@example.com'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin@example.com'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'outsider@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (user_id, email) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'teacher@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'other-teacher@example.com'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'learner@example.com'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin@example.com'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'outsider@example.com')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'teacher'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'teacher'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin')
ON CONFLICT DO NOTHING;

-- Class C owned by T; a cohort starting today; learner L registered in it.
INSERT INTO public.classes (id, owner_user_id, track, title, slug, summary, status)
VALUES ('11111111-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'basic_training', 'Test Class', 'test-class-curriculum-v2',
        'A test class used by the curriculum v2 pgTAP suite.', 'draft');

INSERT INTO public.cohorts (id, class_id, label, start_date, end_date, timezone, registration_url, status)
VALUES ('55555555-0000-0000-0000-000000000000', '11111111-0000-0000-0000-000000000000',
        'Cohort 1', CURRENT_DATE, CURRENT_DATE + 30, 'UTC', 'https://example.com/register', 'draft');

INSERT INTO public.cohort_registrations (cohort_id, user_id)
VALUES ('55555555-0000-0000-0000-000000000000', 'cccccccc-cccc-cccc-cccc-cccccccccccc');

-- One published section with two published required modules in order.
INSERT INTO public.class_module_sections (id, class_id, title, position, status, created_by)
VALUES ('22222222-0000-0000-0000-000000000000', '11111111-0000-0000-0000-000000000000',
        'Section 1', 1, 'published', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO public.class_module_items (id, section_id, class_id, title, position, content_html, required, status, created_by)
VALUES
  ('33333333-0000-0000-0000-000000000000', '22222222-0000-0000-0000-000000000000',
   '11111111-0000-0000-0000-000000000000', 'Module 1', 1, '<p>lesson one</p>', true, 'published',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('44444444-0000-0000-0000-000000000000', '22222222-0000-0000-0000-000000000000',
   '11111111-0000-0000-0000-000000000000', 'Module 2', 2, '<p>lesson two</p>', true, 'published',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

SET session_replication_role = default;

-- ── Release engine (class_item_release takes an explicit user; callable here) ──
-- 1. all_at_once (the default): M1 is released to L.
SELECT is((SELECT released FROM public.class_item_release(
  '33333333-0000-0000-0000-000000000000', 'cccccccc-cccc-cccc-cccc-cccccccccccc')),
  true, 'all_at_once: published module is released');

-- 2/3. by_date in the future: locked, with an availability timestamp.
UPDATE public.classes SET release_policy = 'by_date', release_at = now() + interval '10 days'
 WHERE id = '11111111-0000-0000-0000-000000000000';
SELECT is((SELECT released FROM public.class_item_release(
  '33333333-0000-0000-0000-000000000000', 'cccccccc-cccc-cccc-cccc-cccccccccccc')),
  false, 'by_date future: module is locked');
SELECT isnt((SELECT available_at FROM public.class_item_release(
  '33333333-0000-0000-0000-000000000000', 'cccccccc-cccc-cccc-cccc-cccccccccccc')),
  NULL, 'by_date: available_at is populated');

-- 4. by_date in the past: released.
UPDATE public.classes SET release_at = now() - interval '1 day'
 WHERE id = '11111111-0000-0000-0000-000000000000';
SELECT is((SELECT released FROM public.class_item_release(
  '33333333-0000-0000-0000-000000000000', 'cccccccc-cccc-cccc-cccc-cccccccccccc')),
  true, 'by_date past: module is released');

-- 5/6. relative_to_cohort_start (cohort starts today): offset 0 open, far offset locked.
UPDATE public.classes SET release_policy = 'relative_to_cohort_start', release_at = NULL, release_offset_days = 0
 WHERE id = '11111111-0000-0000-0000-000000000000';
SELECT is((SELECT released FROM public.class_item_release(
  '33333333-0000-0000-0000-000000000000', 'cccccccc-cccc-cccc-cccc-cccccccccccc')),
  true, 'relative offset 0: released on cohort start day');
UPDATE public.classes SET release_offset_days = 3650
 WHERE id = '11111111-0000-0000-0000-000000000000';
SELECT is((SELECT released FROM public.class_item_release(
  '33333333-0000-0000-0000-000000000000', 'cccccccc-cccc-cccc-cccc-cccccccccccc')),
  false, 'relative far offset: still locked');

-- 7/8/9. after_previous_completion: first open, second locked until first done.
UPDATE public.classes SET release_policy = 'after_previous_completion', release_offset_days = NULL
 WHERE id = '11111111-0000-0000-0000-000000000000';
SELECT is((SELECT released FROM public.class_item_release(
  '33333333-0000-0000-0000-000000000000', 'cccccccc-cccc-cccc-cccc-cccccccccccc')),
  true, 'drip: first required module is open');
SELECT is((SELECT released FROM public.class_item_release(
  '44444444-0000-0000-0000-000000000000', 'cccccccc-cccc-cccc-cccc-cccccccccccc')),
  false, 'drip: second module locked until first completed');
INSERT INTO public.class_module_progress (user_id, item_id, class_id, completed, completed_at)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-0000-0000-0000-000000000000',
        '11111111-0000-0000-0000-000000000000', true, now());
SELECT is((SELECT released FROM public.class_item_release(
  '44444444-0000-0000-0000-000000000000', 'cccccccc-cccc-cccc-cccc-cccccccccccc')),
  true, 'drip: second module unlocks after first is completed');
DELETE FROM public.class_module_progress WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

-- ── Learner read path + direct-read gate (as L) ───────────────────────────────
-- Set a future by_date lock so the body must be omitted / hidden.
UPDATE public.classes SET release_policy = 'by_date', release_at = now() + interval '10 days',
       release_offset_days = NULL
 WHERE id = '11111111-0000-0000-0000-000000000000';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';

-- 10/11. The read RPC returns the locked module but WITHOUT its body (F1).
SELECT is(
  (public.get_class_curriculum_for_learner('11111111-0000-0000-0000-000000000000')
    ->'sections'->0->'items'->0->>'released'),
  'false', 'read RPC: locked module reports released=false');
SELECT is(
  (public.get_class_curriculum_for_learner('11111111-0000-0000-0000-000000000000')
    ->'sections'->0->'items'->0->>'content_html'),
  NULL, 'read RPC: locked module body is omitted');

-- 12. Raw PostgREST-style direct read of the locked item returns nothing (F1).
SELECT is(
  (SELECT count(*)::int FROM public.class_module_items
    WHERE id = '33333333-0000-0000-0000-000000000000'),
  0, 'direct table read: locked module row is hidden by RLS');

RESET ROLE;

-- 13/14. Under all_at_once the same learner CAN read (released) — no regression.
UPDATE public.classes SET release_policy = 'all_at_once', release_at = NULL
 WHERE id = '11111111-0000-0000-0000-000000000000';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM public.class_module_items
    WHERE id = '33333333-0000-0000-0000-000000000000'),
  1, 'all_at_once: released module row is readable directly');
SELECT isnt(
  (public.get_class_curriculum_for_learner('11111111-0000-0000-0000-000000000000')
    ->'sections'->0->'items'->0->>'content_html'),
  NULL, 'all_at_once: released module body is returned');
RESET ROLE;

-- ── Authoring authorization (F3, IDOR, admin) ─────────────────────────────────
-- 15. Another teacher who does not own the class cannot author in it.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT public.upsert_class_module_item('22222222-0000-0000-0000-000000000000', NULL,
       'Hijack', NULL, NULL, 'read', NULL, true, 'draft') $$,
  '42501', NULL, 'a non-owner teacher cannot author in the class');
RESET ROLE;

-- 16. The owner loses the 'teacher' role → can no longer author (F3).
DELETE FROM public.user_roles
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND role = 'teacher';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT public.upsert_class_module_item('22222222-0000-0000-0000-000000000000', NULL,
       'After unapproval', NULL, NULL, 'read', NULL, true, 'draft') $$,
  '42501', NULL, 'un-approved owner is blocked from authoring (F3)');
RESET ROLE;
INSERT INTO public.user_roles (user_id, role)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'teacher') ON CONFLICT DO NOTHING;

-- 17. An admin can author.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';
SELECT lives_ok(
  $$ SELECT public.upsert_class_section('11111111-0000-0000-0000-000000000000', NULL,
       'Admin section', NULL, 'draft') $$,
  'an admin can author curriculum in any class');
RESET ROLE;

-- 18. An unrelated outsider cannot even read the curriculum.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT public.get_class_curriculum_for_learner('11111111-0000-0000-0000-000000000000') $$,
  '42501', NULL, 'a non-entitled outsider is forbidden from the read RPC');
RESET ROLE;

-- ── Completion release-guard (F5, as L) ───────────────────────────────────────
-- 19. Cannot complete a locked module.
UPDATE public.classes SET release_policy = 'by_date', release_at = now() + interval '10 days'
 WHERE id = '11111111-0000-0000-0000-000000000000';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT public.toggle_class_module_completion('33333333-0000-0000-0000-000000000000', true) $$,
  '42501', NULL, 'learner cannot complete a locked module (F5)');
RESET ROLE;

-- 20. Can complete once released.
UPDATE public.classes SET release_policy = 'all_at_once', release_at = NULL
 WHERE id = '11111111-0000-0000-0000-000000000000';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
SELECT lives_ok(
  $$ SELECT public.toggle_class_module_completion('33333333-0000-0000-0000-000000000000', true) $$,
  'learner can complete a released module');
RESET ROLE;

-- ── File & link content security (as owner-teacher T) ─────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

-- 21/22. Link URL validation.
SELECT throws_ok(
  $$ SELECT public.upsert_class_module_link('33333333-0000-0000-0000-000000000000', NULL,
       'javascript:alert(1)', NULL) $$,
  '22023', NULL, 'javascript: link is rejected');
SELECT lives_ok(
  $$ SELECT public.upsert_class_module_link('33333333-0000-0000-0000-000000000000', NULL,
       'https://example.com/reading', 'Reading') $$,
  'a valid https link is accepted');

-- 23. Disallowed MIME type is rejected.
SELECT throws_ok(
  $$ SELECT public.register_class_module_file('33333333-0000-0000-0000-000000000000',
       'class/11111111-0000-0000-0000-000000000000/item/33333333-0000-0000-0000-000000000000/x',
       'x.exe', 'application/x-msdownload', 10) $$,
  '22023', NULL, 'executable MIME type is rejected (allowlist)');

-- 24. Storage path scoped to a DIFFERENT class is rejected (IDOR guard).
SELECT throws_ok(
  $$ SELECT public.register_class_module_file('33333333-0000-0000-0000-000000000000',
       'class/99999999-0000-0000-0000-000000000000/item/33333333-0000-0000-0000-000000000000/x.pdf',
       'x.pdf', 'application/pdf', 10) $$,
  '22023', NULL, 'a storage path for another class is rejected (IDOR)');
RESET ROLE;

-- ── Signed-file read gate (can_read_class_module_file) ────────────────────────
-- Lock the item by date, then check the storage read predicate per role.
UPDATE public.classes SET release_policy = 'by_date', release_at = now() + interval '10 days'
 WHERE id = '11111111-0000-0000-0000-000000000000';

-- 25. A learner cannot read a locked file's bytes.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
SELECT is(
  public.can_read_class_module_file(
    'class/11111111-0000-0000-0000-000000000000/item/33333333-0000-0000-0000-000000000000/x.pdf'),
  false, 'learner cannot read a locked file (storage gate)');
RESET ROLE;

-- 26. The owner always can (preview).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
SELECT is(
  public.can_read_class_module_file(
    'class/11111111-0000-0000-0000-000000000000/item/33333333-0000-0000-0000-000000000000/x.pdf'),
  true, 'owner can read the file for preview');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
