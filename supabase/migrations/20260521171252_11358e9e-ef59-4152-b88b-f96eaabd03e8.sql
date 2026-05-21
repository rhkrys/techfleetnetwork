-- Re-backfill from the audit log: take the earliest verified event per user
UPDATE public.profiles p
SET discord_linked_at = sub.first_verified
FROM (
  SELECT user_id, MIN(created_at) AS first_verified
  FROM public.audit_log
  WHERE event_type = 'discord_username_verified'
    AND user_id IS NOT NULL
  GROUP BY user_id
) sub
WHERE p.user_id = sub.user_id
  AND p.discord_user_id IS NOT NULL
  AND p.discord_user_id <> '';

-- For users with no audit-log entry, fall back to profile created_at (conservative — never inflates past-7d)
UPDATE public.profiles p
SET discord_linked_at = p.created_at
WHERE p.discord_user_id IS NOT NULL
  AND p.discord_user_id <> ''
  AND p.discord_linked_at IS NULL;

-- Also overwrite cases where discord_linked_at was poisoned by the prior backfill
-- (i.e. it equals the badge timestamp which equals updated_at). Trust audit log over the badge.
UPDATE public.profiles p
SET discord_linked_at = sub.first_verified
FROM (
  SELECT user_id, MIN(created_at) AS first_verified
  FROM public.audit_log
  WHERE event_type = 'discord_username_verified'
    AND user_id IS NOT NULL
  GROUP BY user_id
) sub
WHERE p.user_id = sub.user_id
  AND p.discord_linked_at IS DISTINCT FROM sub.first_verified;

-- Re-stamp badges_awarded with the corrected discord_linked_at
UPDATE public.badges_awarded b
SET awarded_at = p.discord_linked_at
FROM public.profiles p
WHERE b.user_id = p.user_id
  AND b.badge_code = 'discord_linked'
  AND p.discord_linked_at IS NOT NULL
  AND b.awarded_at <> p.discord_linked_at;

-- Refresh snapshot
SELECT public.recompute_all_stats();
