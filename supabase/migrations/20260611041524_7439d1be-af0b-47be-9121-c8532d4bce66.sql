-- Ship 2: silence `discord_username_not_found` in Triage
-- Adds a fingerprint-mode entry to known_issue_catalog so any historical or
-- future row of this kind is dropped before reaching agent_fix_queue, even
-- if the severity tag was missing (back-compat with rows logged before the
-- writer now tags severity:info). Triage discovery already skips non-error
-- severity tags, so this is a belt-and-suspenders backstop.
INSERT INTO public.known_issue_catalog (pattern, match_kind, event_type_filter, reason, is_active)
VALUES (
  '18d6186852440c10628b405e76ea6c466cee8e1cefaf5ed59e47bd9dbc0a9854',
  'fingerprint',
  'discord_username_not_found',
  'Expected UX: member typed a Discord handle that is not in the guild yet. Writer now tags severity:info (resolve-discord-id/index.ts).',
  true
)
ON CONFLICT (pattern, match_kind, event_type_filter) DO UPDATE
SET is_active = EXCLUDED.is_active, reason = EXCLUDED.reason, updated_at = now();

-- Ship 4: turn on Email Subsystem v2 for the BULK lane only (bitmask bit 4).
-- The 2026-06-01 incident showed the legacy bulk path saturated the workspace
-- token bucket and bled 429s into the signup/recovery lanes. Routing bulk
-- through v2 puts it behind the per-lane CircuitBreaker, which (with the
-- threshold tightened to 2 in the same shipment) opens after the second 429
-- inside a 10-minute window — stopping the bleed before auth/recovery are
-- affected. Auth + transactional remain on the proven legacy path until the
-- 72h soak gate (docs/runbooks/email-subsystem-v2.md) green-lights bitmask=7.
UPDATE public.email_send_state
SET pipeline_v2_lanes_bitmask = 4, updated_at = now()
WHERE id = 1;