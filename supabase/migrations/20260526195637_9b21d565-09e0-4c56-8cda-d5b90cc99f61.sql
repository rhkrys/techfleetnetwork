DROP POLICY IF EXISTS "Scoped realtime read access" ON realtime.messages;
DROP POLICY IF EXISTS "Scoped realtime write access" ON realtime.messages;

CREATE POLICY "Scoped realtime read access"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  CASE
    WHEN (realtime.topic() = ANY (ARRAY['system_health_state'::text, 'system_remediations'::text, 'system-health-live'::text, 'project-blasts-health'::text]))
         OR (realtime.topic() LIKE 'admin:%')
      THEN public.has_role(auth.uid(), 'admin'::public.app_role)
    WHEN realtime.topic() LIKE 'user:' || auth.uid()::text || ':%'
      THEN true
    ELSE false
  END
);

CREATE POLICY "Scoped realtime write access"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  CASE
    WHEN (realtime.topic() = ANY (ARRAY['system_health_state'::text, 'system_remediations'::text, 'system-health-live'::text, 'project-blasts-health'::text]))
         OR (realtime.topic() LIKE 'admin:%')
      THEN public.has_role(auth.uid(), 'admin'::public.app_role)
    WHEN realtime.topic() LIKE 'user:' || auth.uid()::text || ':%'
      THEN true
    ELSE false
  END
);

CREATE POLICY "dpa self read"
ON public.dpa_executions
FOR SELECT
TO authenticated
USING (auth.uid() = created_by);

CREATE POLICY "dispute self read"
ON public.dispute_intake
FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);