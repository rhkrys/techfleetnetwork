// Pg adapter for OutboxRepo — wraps the SECURITY DEFINER RPCs.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { ClaimedRow, OutboxRepo } from '../ports.ts';
import type { EmailEnvelope, ProviderOutcome } from '../domain/types.ts';

export function makePgOutboxRepo(supabase: SupabaseClient): OutboxRepo {
  return {
    async enqueue(env: EmailEnvelope) {
      const { data, error } = await supabase.rpc('enqueue_email_v2', {
        p_lane: env.lane, p_template: env.template, p_recipient: env.recipient,
        p_subject: env.subject ?? null, p_payload: env.payload,
        p_idempotency_key: env.idempotencyKey, p_message_id: env.messageId,
        p_trace_id: env.traceId ?? null,
      });
      if (error) throw new Error(`enqueue_email_v2: ${error.message}`);
      return data as string;
    },

    async claimDue(max: number) {
      const { data, error } = await supabase.rpc('claim_due_emails', { p_max: max });
      if (error) throw new Error(`claim_due_emails: ${error.message}`);
      return (data ?? []).map((r: Record<string, unknown>): ClaimedRow => ({
        id: String(r.id), lane: r.lane as ClaimedRow['lane'],
        template: String(r.template), recipient: String(r.recipient),
        subject: r.subject ? String(r.subject) : undefined,
        payload: (r.payload ?? {}) as Record<string, unknown>,
        idempotencyKey: String(r.idempotency_key), messageId: String(r.message_id),
        attempts: Number(r.attempts ?? 0),
        traceId: r.trace_id ? String(r.trace_id) : undefined,
      }));
    },

    async recordResult(id: string, outcome: ProviderOutcome) {
      const args = outcomeToRpcArgs(id, outcome);
      const { error } = await supabase.rpc('record_email_attempt_result', args);
      if (error) throw new Error(`record_email_attempt_result: ${error.message}`);
    },

    async gcExpired() {
      const { data, error } = await supabase.rpc('gc_expired_email_outbox');
      if (error) throw new Error(`gc_expired_email_outbox: ${error.message}`);
      return Number(data ?? 0);
    },
  };
}

function outcomeToRpcArgs(id: string, o: ProviderOutcome) {
  if (o.kind === 'sent') {
    return { p_id: id, p_outcome: 'sent', p_status_code: o.statusCode,
      p_error: null, p_retry_after_s: null, p_workspace_quota: false };
  }
  if (o.kind === 'rate_limited') {
    return { p_id: id, p_outcome: 'rate_limited', p_status_code: 429,
      p_error: o.raw ?? null, p_retry_after_s: o.retryAfterSeconds, p_workspace_quota: o.workspaceQuota };
  }
  if (o.kind === 'suppressed') {
    return { p_id: id, p_outcome: 'suppressed', p_status_code: null,
      p_error: o.reason, p_retry_after_s: null, p_workspace_quota: false };
  }
  if (o.kind === 'permanent_fail') {
    return { p_id: id, p_outcome: 'permanent_fail', p_status_code: o.statusCode,
      p_error: o.message, p_retry_after_s: null, p_workspace_quota: false };
  }
  return { p_id: id, p_outcome: 'error', p_status_code: o.statusCode,
    p_error: o.message, p_retry_after_s: null, p_workspace_quota: false };
}
