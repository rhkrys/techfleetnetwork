-- PR 5 (email rearchitecture): re-gate the quest-nudge email onto notify_opportunities.
--
-- quest-nudge is Tier 1 (service/opportunity). It gated on notify_announcements (the retired flag)
-- via get_nudgeable_quest_users, which returned that column. Switch the RPC to return
-- notify_opportunities so the edge function gates on the Tier-1 opt-out (the toggle in the
-- preference center). Reproduced verbatim from 20260531041335 with ONLY the two notify_announcements
-- references changed to notify_opportunities.
--
-- Changing a RETURNS TABLE column is a return-type change, so this DROPs and re-CREATEs (re-granting
-- service_role EXECUTE). Cutover is fail-safe: if the edge and RPC are momentarily out of step, the
-- gate reads undefined -> no quest email that tick (never a wrong send). Only affects a non-critical
-- nudge.

DROP FUNCTION IF EXISTS public.get_nudgeable_quest_users(int, int);

CREATE OR REPLACE FUNCTION public.get_nudgeable_quest_users(
  p_inactivity_days int DEFAULT 7,
  p_nudge_interval_days int DEFAULT 7
)
RETURNS TABLE (
  selection_id uuid, user_id uuid, path_id uuid,
  path_title text, path_slug text,
  total_steps int, completed_count int,
  email text, first_name text, display_name text,
  notify_opportunities boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH candidates AS (
    SELECT s.id AS selection_id, s.user_id, s.path_id
    FROM public.user_quest_selections s
    WHERE s.started_at IS NOT NULL
      AND s.completed_at IS NULL
      AND (s.last_nudged_at IS NULL
           OR s.last_nudged_at < now() - make_interval(days => p_nudge_interval_days))
      AND NOT EXISTS (
        SELECT 1 FROM public.journey_progress jp
        WHERE jp.user_id = s.user_id
          AND jp.updated_at > now() - make_interval(days => p_inactivity_days)
      )
  ),
  step_counts AS (
    SELECT path_id, count(*)::int AS total
    FROM public.quest_path_steps
    WHERE path_id IN (SELECT path_id FROM candidates)
    GROUP BY path_id
  ),
  user_done AS (
    SELECT user_id, count(*)::int AS done
    FROM public.journey_progress
    WHERE completed = true
      AND user_id IN (SELECT user_id FROM candidates)
    GROUP BY user_id
  )
  SELECT c.selection_id, c.user_id, c.path_id,
         p.title, p.slug,
         COALESCE(sc.total,0), COALESCE(ud.done,0),
         pr.email, pr.first_name, pr.display_name, pr.notify_opportunities
  FROM candidates c
  JOIN public.quest_paths p ON p.id = c.path_id
  LEFT JOIN step_counts sc ON sc.path_id = c.path_id
  LEFT JOIN user_done   ud ON ud.user_id = c.user_id
  JOIN public.profiles pr ON pr.user_id = c.user_id
  WHERE pr.email IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.get_nudgeable_quest_users(int, int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_nudgeable_quest_users(int, int) TO service_role;
