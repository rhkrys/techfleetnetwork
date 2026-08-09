-- pgTAP suite for audit T-H — generic per-identity edge rate limiter.
BEGIN;
SELECT plan(7);

SELECT has_table('public', 'edge_rate_limits', 'edge_rate_limits table exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.edge_rate_limits'::regclass),
  'RLS enabled (deny-by-default) on edge_rate_limits');

-- Under a cap of 2 for one (action, identifier): allow, allow, then block.
SELECT is((public.check_edge_rate_limit('1.2.3.4', 'web_vital', 2, 1) ->> 'allowed')::boolean, true,  'call 1 allowed');
SELECT is((public.check_edge_rate_limit('1.2.3.4', 'web_vital', 2, 1) ->> 'allowed')::boolean, true,  'call 2 (==cap) allowed');
SELECT is((public.check_edge_rate_limit('1.2.3.4', 'web_vital', 2, 1) ->> 'allowed')::boolean, false, 'call 3 (>cap) blocked');

-- Same identifier, DIFFERENT action = independent bucket.
SELECT is((public.check_edge_rate_limit('1.2.3.4', 'i18n_bundle', 2, 1) ->> 'allowed')::boolean, true,
  'a different action has its own bucket for the same IP');

-- Least privilege.
SELECT ok(
  NOT has_function_privilege('anon', 'public.check_edge_rate_limit(text,text,integer,integer)', 'execute'),
  'anon cannot execute check_edge_rate_limit');

SELECT * FROM finish();
ROLLBACK;
