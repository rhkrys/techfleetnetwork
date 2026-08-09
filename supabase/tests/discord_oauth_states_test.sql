-- pgTAP suite for the Discord OAuth ownership-proof state store (audit H11 follow-up).
-- Run: `supabase db test` (or pg_prove) against a DB with the migrations applied.
-- Proves: schema shape, RLS/grant deny-all, and the single-use / cross-user /
-- expiry semantics of consume_discord_oauth_state(). Runs in a rolled-back txn.

BEGIN;
SELECT plan(15);

-- ── Fixtures: two auth users (A = owner of the OAuth attempt, B = attacker) ──
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b@example.com')
ON CONFLICT (id) DO NOTHING;

-- ── Schema shape ──────────────────────────────────────────────────────────────
SELECT has_table('public', 'discord_oauth_states', 'discord_oauth_states table exists');
SELECT col_is_pk('public', 'discord_oauth_states', 'state', 'state is the primary key');
SELECT has_column('public', 'discord_oauth_states', 'user_id', 'has user_id');
SELECT has_column('public', 'discord_oauth_states', 'redirect_uri', 'has redirect_uri');
SELECT has_column('public', 'discord_oauth_states', 'consumed_at', 'has consumed_at');

-- RLS is enabled and there are NO policies (deny-all by default).
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.discord_oauth_states'::regclass),
  true, 'RLS is enabled on discord_oauth_states');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'discord_oauth_states'),
  0, 'no RLS policies exist (deny-all)');

-- ── Mint + consume happy path (service-role / owner context) ─────────────────
SELECT lives_ok(
  $$ SELECT public.create_discord_oauth_state(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'state-A', 'https://techfleet.network/courses/connect-discord/callback', 600) $$,
  'mint a state for user A');

SELECT is(
  public.consume_discord_oauth_state('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'state-A'),
  'https://techfleet.network/courses/connect-discord/callback',
  'first consume returns the stored redirect_uri');

-- Replay: the same state a second time yields NULL (single-use).
SELECT is(
  public.consume_discord_oauth_state('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'state-A'),
  NULL, 'replay of a consumed state returns null');

-- Cross-user theft: user B cannot consume A''s state.
SELECT public.create_discord_oauth_state(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'state-A2', 'https://techfleet.network/courses/connect-discord/callback', 600);
SELECT is(
  public.consume_discord_oauth_state('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'state-A2'),
  NULL, 'a state minted for A cannot be consumed by B');
-- ...and A can still consume it afterwards (B''s attempt did not consume it).
SELECT is(
  public.consume_discord_oauth_state('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'state-A2'),
  'https://techfleet.network/courses/connect-discord/callback',
  'the rightful owner can still consume after a foiled theft');

-- Expiry: an already-expired row is never consumable.
INSERT INTO public.discord_oauth_states (state, user_id, redirect_uri, expires_at)
VALUES ('state-expired', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'https://techfleet.network/courses/connect-discord/callback', now() - interval '1 minute');
SELECT is(
  public.consume_discord_oauth_state('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'state-expired'),
  NULL, 'an expired state returns null');

-- ── Deny-all as an authenticated member ──────────────────────────────────────
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT * FROM public.discord_oauth_states $$,
  '42501', NULL, 'authenticated member cannot read the state table');

SELECT throws_ok(
  $$ SELECT public.consume_discord_oauth_state('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'state-A2') $$,
  '42501', NULL, 'authenticated member cannot call consume_discord_oauth_state');

RESET role;
SELECT * FROM finish();
ROLLBACK;
