UPDATE public.agent_fix_queue
SET status = 'resolved', resolved_at = now(), updated_at = now()
WHERE status IN ('pending','triaged')
  AND error_message IN (
    'freescout-proxy listMine invoke_error',
    'freescout-proxy listAll invoke_error',
    'freescout-proxy create invoke_error'
  );