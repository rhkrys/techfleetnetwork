-- pgTAP suite for the Fleety foundation RPC hardening (D-24, BDD FLEETY-004).
-- Run: `supabase db test` (or pg_prove) against a DB with the migrations applied.
-- Proves the DEFINER functions are search_path-pinned and least-privilege (the
-- IDOR control for fleety_load_user_memories' caller-supplied p_user_id).
-- Everything runs in a rolled-back transaction.
--
-- Regression guard for the hardening shipped in 20260804220000_harden_fleety_rpc_search_path.sql
-- (ported from the superseded PR #143 — the only part of it not already on main).

BEGIN;
SELECT plan(15);

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

-- ── Systemic least-privilege lockdown (20260816200000): the high-risk edge-only RPCs
--    must not be reachable by anon OR authenticated. Regression guard for the audit finding.
SELECT ok(NOT has_function_privilege('anon',
  'public.fleety_cache_store(text,text,text,text,jsonb,text,vector,uuid)', 'EXECUTE'),
  'anon cannot EXECUTE fleety_cache_store (cache-poisoning guard)');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.fleety_cache_store(text,text,text,text,jsonb,text,vector,uuid)', 'EXECUTE'),
  'authenticated cannot EXECUTE fleety_cache_store');
SELECT ok(NOT has_function_privilege('anon',
  'public.fleety_promote_turn_to_canned(uuid,text,text,text)', 'EXECUTE'),
  'anon cannot EXECUTE fleety_promote_turn_to_canned (answer-injection guard)');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.fleety_promote_turn_to_canned(uuid,text,text,text)', 'EXECUTE'),
  'authenticated cannot EXECUTE fleety_promote_turn_to_canned');
SELECT ok(NOT has_function_privilege('anon',
  'public.fleety_approve_relationship(uuid)', 'EXECUTE'),
  'anon cannot EXECUTE fleety_approve_relationship');
SELECT ok(NOT has_function_privilege('anon',
  'public.fleety_kb_semantic_search(vector,integer)', 'EXECUTE'),
  'anon cannot EXECUTE fleety_kb_semantic_search');

-- General, forward-looking guard: NO fleety_* SECURITY DEFINER function may be anon-executable.
-- fleety_* RPCs are all edge-function-internal (service_role); any new one that leaks to anon
-- fails CI here, so this class of hole can't be reintroduced silently as the surface grows.
SELECT is(
  (SELECT count(*)::int FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.prosecdef
       AND p.proname ~ '^fleety_'
       AND has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'no fleety_* SECURITY DEFINER function is anon-executable (systemic least-privilege guard)');

SELECT * FROM finish();
ROLLBACK;
