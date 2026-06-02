-- Create pgmq queues for Freescout webhook async fan-out
SELECT pgmq.create('q_freescout_events');
SELECT pgmq.create('q_freescout_events_dlq');

-- RPC: enqueue an event from freescout-webhook (service-role only)
CREATE OR REPLACE FUNCTION public.freescout_enqueue_event(
  p_event_id text,
  p_event_type text,
  p_payload jsonb
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq
AS $$
DECLARE
  msg_id bigint;
BEGIN
  SELECT pgmq.send(
    'q_freescout_events',
    jsonb_build_object(
      'event_id', p_event_id,
      'event_type', p_event_type,
      'payload', p_payload
    )
  ) INTO msg_id;
  RETURN msg_id;
END;
$$;

REVOKE ALL ON FUNCTION public.freescout_enqueue_event(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.freescout_enqueue_event(text, text, jsonb) TO service_role;

-- RPC: dequeue a batch for the processor
CREATE OR REPLACE FUNCTION public.freescout_dequeue_events(
  p_batch integer DEFAULT 25,
  p_vt integer DEFAULT 60
) RETURNS TABLE(msg_id bigint, read_ct integer, message jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq
AS $$
BEGIN
  RETURN QUERY
  SELECT q.msg_id, q.read_ct, q.message
  FROM pgmq.read('q_freescout_events', p_vt, p_batch) AS q;
END;
$$;

REVOKE ALL ON FUNCTION public.freescout_dequeue_events(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.freescout_dequeue_events(integer, integer) TO service_role;

-- RPC: mark an event processed
CREATE OR REPLACE FUNCTION public.freescout_delete_event(p_msg_id bigint) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq
AS $$
DECLARE
  ok boolean;
BEGIN
  SELECT pgmq.delete('q_freescout_events', p_msg_id) INTO ok;
  RETURN ok;
END;
$$;

REVOKE ALL ON FUNCTION public.freescout_delete_event(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.freescout_delete_event(bigint) TO service_role;

-- RPC: send a poisoned event to the DLQ and remove it from the live queue
CREATE OR REPLACE FUNCTION public.freescout_send_to_dlq(
  p_msg_id bigint,
  p_message jsonb,
  p_error text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq
AS $$
DECLARE
  dlq_id bigint;
BEGIN
  SELECT pgmq.send(
    'q_freescout_events_dlq',
    jsonb_build_object(
      'original_msg_id', p_msg_id,
      'message', p_message,
      'error', p_error,
      'failed_at', now()
    )
  ) INTO dlq_id;
  PERFORM pgmq.delete('q_freescout_events', p_msg_id);
  RETURN dlq_id;
END;
$$;

REVOKE ALL ON FUNCTION public.freescout_send_to_dlq(bigint, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.freescout_send_to_dlq(bigint, jsonb, text) TO service_role;
