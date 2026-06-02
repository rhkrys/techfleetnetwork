ALTER TABLE public.revoked_sessions
ADD COLUMN IF NOT EXISTS revoke_before timestamptz;

CREATE INDEX IF NOT EXISTS idx_revoked_sessions_revoke_before
ON public.revoked_sessions(user_id, revoke_before DESC);

CREATE OR REPLACE FUNCTION public.is_session_revoked(_user_id uuid, _issued_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.revoked_sessions
    WHERE user_id = _user_id
      AND (
        (revoke_before IS NOT NULL AND _issued_at < revoke_before)
        OR (revoke_before IS NULL AND revoked_at > _issued_at)
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_session_revoked(uuid, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_session_revoked(uuid, timestamp with time zone) TO authenticated, service_role;