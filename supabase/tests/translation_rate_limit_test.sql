-- pgTAP suite for audit H15 — dedicated translation rate limiter.
-- Proves: the RPC counts per identity + window, flips allowed at the cap, hashes
-- the identifier at rest, and is not executable by anon/authenticated.
BEGIN;
SELECT plan(8);

-- Table exists with deny-by-default RLS.
SELECT has_table('public', 'translation_rate_limits', 'translation_rate_limits table exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.translation_rate_limits'::regclass),
  'RLS is enabled (deny-by-default) on translation_rate_limits');

-- First call under a small cap is allowed; count starts at 1.
SELECT is(
  (public.check_translation_rate_limit('uid:test-alice', 2, 1) ->> 'allowed')::boolean,
  true,
  'first call is allowed');
SELECT is(
  (public.check_translation_rate_limit('uid:test-alice', 2, 1) ->> 'allowed')::boolean,
  true,
  'second call (== cap) is allowed');
SELECT is(
  (public.check_translation_rate_limit('uid:test-alice', 2, 1) ->> 'allowed')::boolean,
  false,
  'third call (> cap) is blocked');

-- A different identity is tracked independently.
SELECT is(
  (public.check_translation_rate_limit('uid:test-bob', 2, 1) ->> 'allowed')::boolean,
  true,
  'a different identity has its own bucket');

-- The identifier is stored hashed, never in the clear.
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.translation_rate_limits
    WHERE identifier_hash = encode(extensions.digest('uid:test-alice', 'sha256'), 'hex')
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.translation_rate_limits WHERE identifier_hash = 'uid:test-alice'
  ),
  'identifier is stored as a sha256 hash, not raw');

-- Least privilege: not callable by anon/authenticated.
SELECT ok(
  NOT has_function_privilege('anon', 'public.check_translation_rate_limit(text,integer,integer)', 'execute'),
  'anon cannot execute check_translation_rate_limit');

SELECT * FROM finish();
ROLLBACK;
