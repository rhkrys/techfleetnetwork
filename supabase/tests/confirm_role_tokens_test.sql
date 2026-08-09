-- pgTAP suite for audit Wave 1 role-confirmation hardening (H12/H13).
-- Run: `supabase db test`. Proves the DB-layer guarantees: expiry columns,
-- teacher hash-at-rest (mirror of admin), hashed verifiers that surface
-- expires_at, and that the verifiers are not executable by anon/authenticated.
-- Everything runs in a rolled-back transaction.

BEGIN;
SELECT plan(12);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'target@example.com'),
  ('99999999-9999-9999-9999-999999999999', 'promoter@example.com')
ON CONFLICT (id) DO NOTHING;

-- ── H12: expiry columns exist ────────────────────────────────────────────────
SELECT has_column('public', 'admin_promotions',   'expires_at', 'admin_promotions.expires_at exists (H12)');
SELECT has_column('public', 'teacher_promotions', 'expires_at', 'teacher_promotions.expires_at exists (H12)');

-- ── H13: teacher token is hashed at rest by the trigger ──────────────────────
INSERT INTO public.teacher_promotions (id, user_id, promoted_by, token)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',
        '99999999-9999-9999-9999-999999999999',
        repeat('a', 64));

SELECT is(
  (SELECT token_hash FROM public.teacher_promotions WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  encode(extensions.digest(repeat('a', 64), 'sha256'), 'hex'),
  'teacher hashing trigger populates token_hash (H13)');

SELECT ok(
  (SELECT expires_at FROM public.teacher_promotions WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001')
    BETWEEN now() + interval '6 days' AND now() + interval '8 days',
  'teacher_promotions.expires_at defaults ~7 days out (H12)');

-- verify RPC resolves the owner by hashing the plaintext token internally
SELECT is(
  (SELECT user_id FROM public.verify_teacher_promotion_token(repeat('a', 64))),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'verify_teacher_promotion_token resolves the owner via hash (H13)');

SELECT ok(
  (SELECT expires_at FROM public.verify_teacher_promotion_token(repeat('a', 64))) IS NOT NULL,
  'verify_teacher_promotion_token returns expires_at');

SELECT is(
  (SELECT count(*)::int FROM public.verify_teacher_promotion_token(repeat('b', 64))),
  0,
  'verify_teacher_promotion_token returns nothing for an unknown token');

-- ── H12: admin verifier now surfaces expires_at ──────────────────────────────
INSERT INTO public.admin_promotions (id, user_id, promoted_by, token)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',
        '99999999-9999-9999-9999-999999999999',
        repeat('c', 64));

SELECT ok(
  (SELECT expires_at FROM public.admin_promotions WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001')
    BETWEEN now() + interval '6 days' AND now() + interval '8 days',
  'admin_promotions.expires_at defaults ~7 days out (H12)');

SELECT is(
  (SELECT user_id FROM public.verify_admin_promotion_token(repeat('c', 64))),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'verify_admin_promotion_token resolves the owner via hash');

SELECT ok(
  (SELECT expires_at FROM public.verify_admin_promotion_token(repeat('c', 64))) IS NOT NULL,
  'verify_admin_promotion_token now returns expires_at (H12)');

-- ── Least privilege: verifiers are not callable by anon/authenticated ────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.verify_teacher_promotion_token(text)', 'execute'),
  'anon cannot execute verify_teacher_promotion_token');

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.verify_admin_promotion_token(text)', 'execute'),
  'authenticated cannot execute verify_admin_promotion_token');

SELECT * FROM finish();
ROLLBACK;
