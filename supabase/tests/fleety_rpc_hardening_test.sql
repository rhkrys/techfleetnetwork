-- pgTAP suite for the Fleety foundation RPC hardening (D-24, BDD FLEETY-004).
-- Run: `supabase db test` (or pg_prove) against a DB with the migrations applied.
-- Proves the DEFINER functions are search_path-pinned and least-privilege (the
-- IDOR control for fleety_load_user_memories' caller-supplied p_user_id).
-- Everything runs in a rolled-back transaction.
--
-- Regression guard for the hardening shipped in 20260804220000_harden_fleety_rpc_search_path.sql
-- (ported from the superseded PR #143 — the only part of it not already on main).

BEGIN;
SELECT plan(8);

-- ── fleety_observe_synonym ───────────────────────────────────────────────────
SELECT is(
  (SELECT prosecdef FROM pg_proc
     WHERE oid = 'public.fleety_observe_synonym(text,text,text,int)'::regprocedure),
  true, 'fleety_observe_synonym is SECURITY DEFINER');

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_proc p, unnest(p.proconfig) AS c
    WHERE p.oid = 'public.fleety_observe_synonym(text,text,text,int)'::regprocedure
      AND c LIKE 'search_path=%'  -- Postgres stores empty as search_path="" (not search_path=)
  ),
  'fleety_observe_synonym pins search_path (not the caller default)');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.fleety_observe_synonym(text,text,text,int)', 'EXECUTE'),
  'authenticated cannot EXECUTE fleety_observe_synonym');

-- ── fleety_load_user_memories ────────────────────────────────────────────────
SELECT is(
  (SELECT prosecdef FROM pg_proc
     WHERE oid = 'public.fleety_load_user_memories(uuid)'::regprocedure),
  true, 'fleety_load_user_memories is SECURITY DEFINER');

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_proc p, unnest(p.proconfig) AS c
    WHERE p.oid = 'public.fleety_load_user_memories(uuid)'::regprocedure
      AND c LIKE 'search_path=%'  -- Postgres stores empty as search_path="" (not search_path=)
  ),
  'fleety_load_user_memories pins search_path (not the caller default)');

-- IDOR control: caller-supplied p_user_id is safe ONLY because the fn is not
-- reachable by the authenticated/anon roles — assert that grant-scoping holds.
SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.fleety_load_user_memories(uuid)', 'EXECUTE'),
  'authenticated cannot EXECUTE fleety_load_user_memories (IDOR guard)');

SELECT ok(
  NOT has_function_privilege('anon',
    'public.fleety_load_user_memories(uuid)', 'EXECUTE'),
  'anon cannot EXECUTE fleety_load_user_memories');

SELECT ok(
  has_function_privilege('service_role',
    'public.fleety_load_user_memories(uuid)', 'EXECUTE'),
  'service_role CAN EXECUTE fleety_load_user_memories');

SELECT * FROM finish();
ROLLBACK;
