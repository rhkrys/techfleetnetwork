-- ============================================================
-- Feature flags — a single-owner table of runtime on/off + %-rollout switches.
-- ADR-0021 (observability rollout). Purpose: gate risky rollouts (first use:
-- logger.error -> error reporter) with a gradual dial and a TRUE kill-switch,
-- flippable by an admin WITHOUT a deploy.
--
-- Modeled on public.audit_event_policy: admin-managed + authenticated-read RLS,
-- plus a SECURITY DEFINER accessor RPC so the (possibly signed-out) client
-- reporter can read flags without a session. Flags are non-secret.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  rollout_percent integer NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  description text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

-- Only admins may create/flip/delete a flag (the single writer/owner).
CREATE POLICY "Admins manage feature flags"
ON public.feature_flags
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Authenticated clients may read flags (anon reads go through get_feature_flags()).
CREATE POLICY "Authenticated read feature flags"
ON public.feature_flags
FOR SELECT TO authenticated
USING (true);

-- Seed the flags this release introduces — all OFF (kill-switch default). Merging
-- this migration changes NOTHING at runtime until an admin ramps rollout_percent.
INSERT INTO public.feature_flags (key, enabled, rollout_percent, description) VALUES
  ('logger_error_reporting', false, 0,
   'Forward logger.error(...) to the error reporter (audit_log). Ramp only AFTER the PII-redaction fix lands; enabled=false is the kill-switch. See ADR-0021.')
ON CONFLICT (key) DO NOTHING;

-- Anon-readable read path (SECURITY DEFINER). The client error reporter runs for
-- signed-out users too, so flags must be readable without a session. Only non-secret
-- columns are exposed. NOTE: this deliberately diverges from get_audit_policy()
-- (which is authenticated-only) — the explicit grant below makes that a reviewed
-- decision, not an accident.
CREATE OR REPLACE FUNCTION public.get_feature_flags()
RETURNS TABLE(key text, enabled boolean, rollout_percent integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT key, enabled, rollout_percent FROM public.feature_flags;
$$;

-- Postgres grants EXECUTE to PUBLIC on every CREATE FUNCTION (Supabase advisor
-- 0028/0029 — the defect 20260818120000_security_definer_grant_relock.sql fixed).
-- Lock it down and re-grant deliberately: anon + authenticated only (flags are
-- non-secret; edge functions read the table directly via service_role, not this RPC).
REVOKE ALL     ON FUNCTION public.get_feature_flags() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_feature_flags() TO anon, authenticated;
