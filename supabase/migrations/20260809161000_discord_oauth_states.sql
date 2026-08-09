-- Audit H11 follow-up — real Discord ownership-proof (OAuth authorization_code).
--
-- The interim lockdown (20260809130000) disabled resolve-discord-id's
-- self-service bind because nothing proved the caller controlled the Discord
-- snowflake they asked us to write onto their profile. This migration adds the
-- server state store for the permanent fix: a single-use, short-lived CSRF
-- `state` nonce that binds an in-flight Discord OAuth authorization to exactly
-- one Tech Fleet user. The identity write itself still happens only after the
-- discord-oauth-callback edge function exchanges the code and confirms the
-- Discord /users/@me snowflake — see that function.
--
-- The table is edge-only: RLS is enabled with NO policies, so anon/authenticated
-- callers can neither read nor write it. Only the service role (edge functions,
-- which bypass RLS) and the two SECURITY DEFINER helpers below may touch it.

BEGIN;

CREATE TABLE IF NOT EXISTS public.discord_oauth_states (
  state        text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz
);

COMMENT ON TABLE public.discord_oauth_states IS
  'Single-use CSRF state nonces for the Discord account-linking OAuth flow (audit H11 follow-up). Edge-only: RLS on, no policies. Rows self-expire via expires_at and are consumed exactly once by consume_discord_oauth_state().';
COMMENT ON COLUMN public.discord_oauth_states.user_id IS
  'PII:identifier — the Tech Fleet user this OAuth attempt is bound to. Classification: CONFIDENTIAL.';

CREATE INDEX IF NOT EXISTS idx_discord_oauth_states_expires_at
  ON public.discord_oauth_states (expires_at);
CREATE INDEX IF NOT EXISTS idx_discord_oauth_states_user
  ON public.discord_oauth_states (user_id);

ALTER TABLE public.discord_oauth_states ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policies: deny-all for anon/authenticated. Service role bypasses RLS.
REVOKE ALL ON public.discord_oauth_states FROM anon, authenticated;

-- ── Atomic mint ──────────────────────────────────────────────────────────────
-- Called by discord-oauth-start (service role) AFTER it has authenticated the
-- caller's JWT. p_user_id is the authenticated caller. TTL is clamped to a sane
-- [60s, 1800s] window regardless of what the caller passes.
CREATE OR REPLACE FUNCTION public.create_discord_oauth_state(
  p_user_id uuid,
  p_state text,
  p_redirect_uri text,
  p_ttl_seconds integer DEFAULT 600
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  INSERT INTO public.discord_oauth_states (state, user_id, redirect_uri, expires_at)
  VALUES (
    p_state,
    p_user_id,
    p_redirect_uri,
    now() + make_interval(secs => greatest(60, least(coalesce(p_ttl_seconds, 600), 1800)))
  );
$$;

-- ── Atomic single-use consume ─────────────────────────────────────────────────
-- Returns the stored redirect_uri iff a row exists for (p_state, p_user_id) that
-- is neither expired nor already consumed — and marks it consumed in the SAME
-- statement, so a replay or a concurrent second call gets NULL. Binding to
-- p_user_id (the callback's authenticated JWT) makes a stolen `state` useless to
-- any other session.
CREATE OR REPLACE FUNCTION public.consume_discord_oauth_state(
  p_user_id uuid,
  p_state text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_redirect text;
BEGIN
  UPDATE public.discord_oauth_states
     SET consumed_at = now()
   WHERE state = p_state
     AND user_id = p_user_id
     AND consumed_at IS NULL
     AND expires_at > now()
  RETURNING redirect_uri INTO v_redirect;
  RETURN v_redirect;  -- NULL when no live, unconsumed, matching row exists
END;
$$;

-- ── Opportunistic reaper ──────────────────────────────────────────────────────
-- No cron dependency (this project has a history of un-migrated pg_cron jobs).
-- discord-oauth-start calls this best-effort so the table stays bounded.
CREATE OR REPLACE FUNCTION public.reap_expired_discord_oauth_states()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.discord_oauth_states
   WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.create_discord_oauth_state(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_discord_oauth_state(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reap_expired_discord_oauth_states() FROM PUBLIC, anon, authenticated;

-- Edge functions connect as service_role; grant them execute explicitly since the
-- PUBLIC default was revoked above. (service_role also has bypassrls for the table.)
GRANT EXECUTE ON FUNCTION public.create_discord_oauth_state(uuid, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_discord_oauth_state(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reap_expired_discord_oauth_states() TO service_role;

COMMIT;
