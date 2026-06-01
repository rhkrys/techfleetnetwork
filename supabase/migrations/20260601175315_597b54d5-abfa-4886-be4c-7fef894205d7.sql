
-- Profile linkage
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS freescout_customer_id text,
  ADD COLUMN IF NOT EXISTS freescout_user_id text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_freescout_customer_id_key
  ON public.profiles(freescout_customer_id) WHERE freescout_customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_freescout_user_id_key
  ON public.profiles(freescout_user_id) WHERE freescout_user_id IS NOT NULL;

-- Pointers
CREATE TABLE IF NOT EXISTS public.support_ticket_pointers (
  conversation_id bigint PRIMARY KEY,
  customer_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  freescout_customer_id text,
  subject text,
  last_status text,
  is_private boolean NOT NULL DEFAULT false,
  assignee_user_id text,
  mailbox_id integer,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_pointers_customer ON public.support_ticket_pointers(customer_user_id);
CREATE INDEX IF NOT EXISTS idx_support_pointers_status ON public.support_ticket_pointers(last_status);

GRANT SELECT ON public.support_ticket_pointers TO authenticated;
GRANT ALL ON public.support_ticket_pointers TO service_role;
ALTER TABLE public.support_ticket_pointers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see own pointers"
  ON public.support_ticket_pointers FOR SELECT TO authenticated
  USING (customer_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

-- Events (append-only)
CREATE TABLE IF NOT EXISTS public.support_ticket_events (
  id bigserial PRIMARY KEY,
  conversation_id bigint NOT NULL,
  customer_user_id uuid,
  event_type text NOT NULL,
  actor_email text,
  actor_kind text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_events_conv ON public.support_ticket_events(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_events_user ON public.support_ticket_events(customer_user_id, created_at DESC);

GRANT SELECT ON public.support_ticket_events TO authenticated;
GRANT ALL ON public.support_ticket_events TO service_role;
ALTER TABLE public.support_ticket_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members see own events"
  ON public.support_ticket_events FOR SELECT TO authenticated
  USING (customer_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

-- Provisioning log (append-only)
CREATE TABLE IF NOT EXISTS public.support_provisioning_log (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('customer','admin_user')),
  freescout_id text,
  status text NOT NULL CHECK (status IN ('success','retry','failed','skipped')),
  attempts integer NOT NULL DEFAULT 1,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_prov_user ON public.support_provisioning_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_prov_status ON public.support_provisioning_log(status) WHERE status IN ('retry','failed');

GRANT SELECT ON public.support_provisioning_log TO authenticated;
GRANT ALL ON public.support_provisioning_log TO service_role;
ALTER TABLE public.support_provisioning_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins see provisioning log"
  ON public.support_provisioning_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Webhook idempotency
CREATE TABLE IF NOT EXISTS public.support_webhook_events (
  event_id text PRIMARY KEY,
  event_type text,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_webhook_received ON public.support_webhook_events(received_at);

GRANT ALL ON public.support_webhook_events TO service_role;
ALTER TABLE public.support_webhook_events ENABLE ROW LEVEL SECURITY;

-- Rate limits
CREATE TABLE IF NOT EXISTS public.support_rate_limits (
  subject_user_id uuid NOT NULL,
  action text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (subject_user_id, action, window_start)
);
CREATE INDEX IF NOT EXISTS idx_support_rate_window ON public.support_rate_limits(window_start);

GRANT ALL ON public.support_rate_limits TO service_role;
ALTER TABLE public.support_rate_limits ENABLE ROW LEVEL SECURITY;

-- Rate-limit RPC (caller-scoped)
CREATE OR REPLACE FUNCTION public.support_check_rate_limit(
  _action text,
  _max_per_hour integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _window timestamptz := date_trunc('hour', now());
  _count integer;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  INSERT INTO public.support_rate_limits(subject_user_id, action, window_start, count)
  VALUES (_uid, _action, _window, 1)
  ON CONFLICT (subject_user_id, action, window_start)
  DO UPDATE SET count = public.support_rate_limits.count + 1
  RETURNING count INTO _count;

  IF _count > _max_per_hour THEN
    RAISE EXCEPTION 'rate_limit_exceeded' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.support_rate_limits
  WHERE window_start < now() - interval '24 hours';
END;
$$;
REVOKE ALL ON FUNCTION public.support_check_rate_limit(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_check_rate_limit(text, integer) TO authenticated, service_role;

-- Backfill marker RPC (admin-only)
CREATE OR REPLACE FUNCTION public.support_backfill_provisioning(_mode text)
RETURNS TABLE (queued integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF _mode = 'admins' THEN
    INSERT INTO public.support_provisioning_log(user_id, kind, status, attempts, last_error)
    SELECT ur.user_id, 'admin_user', 'retry', 0, 'queued via backfill'
    FROM public.user_roles ur
    LEFT JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role = 'admin'::app_role
      AND (p.freescout_user_id IS NULL);
    GET DIAGNOSTICS _n = ROW_COUNT;
  ELSIF _mode = 'members' THEN
    INSERT INTO public.support_provisioning_log(user_id, kind, status, attempts, last_error)
    SELECT p.id, 'customer', 'retry', 0, 'queued via backfill'
    FROM public.profiles p
    WHERE p.freescout_customer_id IS NULL;
    GET DIAGNOSTICS _n = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'invalid_mode' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY SELECT _n;
END;
$$;
REVOKE ALL ON FUNCTION public.support_backfill_provisioning(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_backfill_provisioning(text) TO authenticated, service_role;
