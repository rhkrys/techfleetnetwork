-- SECURITY (systemic least-privilege): lock down the Fleety/framework SECURITY DEFINER RPCs.
--
-- Audit finding (prod): ~24 DEFINER functions were EXECUTE-able by BOTH `anon` (unauthenticated —
-- anyone with the public publishable key) AND `authenticated`. They are meant to be called ONLY by
-- the edge functions (techfleet-chat, discord-interactions, etc.) via `service_role`. Exposure incl.:
--   * fleety_cache_store / _promote_turn_to_canned  -> answer-cache / canned-answer POISONING
--   * fleety_approve_relationship                   -> approve arbitrary framework data
--   * fleety_top_expensive_turns / _cost_projection -> other users' query/cost data disclosure
--   * fleety_record_cost / _record_hit / _purge…    -> cost/cache data pollution
--   * the retrieval matchers + kb_semantic_search   -> least-privilege leak
--   (fleety_load_user_memories + fleety_observe_synonym were already fixed in 20260816190000.)
--
-- Fix: REVOKE EXECUTE from anon + authenticated + PUBLIC on the edge-only functions (service_role
-- retains via its BYPASS + explicit grants). KEEP `authenticated` ONLY on the 3 the frontend calls
-- directly with a user JWT — but still revoke `anon` from them (no unauthenticated use):
--   * fleety_record_action        (FleetyChatWidget)
--   * fleety_cost_projection       (admin FleetyCostPanel)  -- TODO: admin-gate in-fn (member-visible)
--   * fleety_top_expensive_turns   (admin FleetyCostPanel)  -- TODO: admin-gate in-fn (member-visible)
-- Discord /fleety is unaffected (discord-interactions runs as service_role). Idempotent.

-- ── Edge-only: revoke from anon + authenticated + PUBLIC ─────────────────────────────
REVOKE EXECUTE ON FUNCTION public.fleety_approve_relationship(uuid)                                   FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fleety_cache_lookup(text, text)                                     FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fleety_cache_record_hit(text, uuid)                                 FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fleety_cache_semantic_lookup(vector, text, double precision)        FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fleety_cache_store(text, text, text, text, jsonb, text, vector, uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fleety_cost_guard_step()                                            FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fleety_few_shot_examples(text, integer)                             FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fleety_kb_semantic_search(vector, integer)                          FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fleety_match_canned_answers(text, text, integer)                    FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fleety_match_examples(text, text, integer)                          FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fleety_match_examples_semantic(vector, integer)                     FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fleety_match_playbooks(text, text, integer)                         FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fleety_match_playbooks_semantic(vector, text, integer)              FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fleety_playbooks_by_intent(text, text, integer)                     FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fleety_promote_turn_to_canned(uuid, text, text, text)               FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fleety_purge_cache_for_turn()                                       FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fleety_recompute_practical_scores(integer)                          FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fleety_record_cost(text, text, bigint, bigint, numeric, boolean, boolean) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.framework_active_source()                                           FROM anon, authenticated, PUBLIC;

-- ── Client-called: revoke anon (+ PUBLIC) only; authenticated retained ───────────────
REVOKE EXECUTE ON FUNCTION public.fleety_record_action(uuid, text, text, text)                        FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fleety_cost_projection()                                            FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fleety_top_expensive_turns(integer)                                 FROM anon, PUBLIC;
