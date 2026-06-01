CREATE TABLE IF NOT EXISTS public.system_health_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component text NOT NULL,
  status text NOT NULL CHECK (status IN ('online', 'offline', 'degraded')),
  reason text,
  detail text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.system_health_events TO authenticated;
GRANT ALL ON public.system_health_events TO service_role;

ALTER TABLE public.system_health_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read system health events" ON public.system_health_events;
CREATE POLICY "Admins can read system health events"
ON public.system_health_events
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_system_health_events_component_created
ON public.system_health_events (component, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_health_events_status_created
ON public.system_health_events (status, created_at DESC);