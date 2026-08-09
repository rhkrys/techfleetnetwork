-- pgTAP suite for audit T-F — support_check_rate_limit_for atomic increment.
BEGIN;
SELECT plan(6);

-- 3/hr cap for a subject user; each call increments and returns allowed?=count<=max.
SELECT is(
  public.support_check_rate_limit_for('c1111111-1111-1111-1111-111111111111', 'discord:support', 3),
  true, 'call 1 of 3 is allowed');
SELECT is(
  public.support_check_rate_limit_for('c1111111-1111-1111-1111-111111111111', 'discord:support', 3),
  true, 'call 2 of 3 is allowed');
SELECT is(
  public.support_check_rate_limit_for('c1111111-1111-1111-1111-111111111111', 'discord:support', 3),
  true, 'call 3 of 3 is allowed');
SELECT is(
  public.support_check_rate_limit_for('c1111111-1111-1111-1111-111111111111', 'discord:support', 3),
  false, 'call 4 exceeds the cap (atomic count, no TOCTOU bypass)');

-- The count advanced atomically on every call (including the rejected 4th).
SELECT is(
  (SELECT count FROM public.support_rate_limits
     WHERE subject_user_id = 'c1111111-1111-1111-1111-111111111111'
       AND action = 'discord:support'
       AND window_start = date_trunc('hour', now())),
  4, 'count reflects every atomic increment');

-- A different action is an independent bucket.
SELECT is(
  public.support_check_rate_limit_for('c1111111-1111-1111-1111-111111111111', 'other:action', 3),
  true, 'a different action is a separate bucket');

SELECT * FROM finish();
ROLLBACK;
