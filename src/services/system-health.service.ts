import { supabase } from "@/integrations/supabase/client";

export interface SystemHealthState {
  status: "healthy" | "degraded" | "overloaded";
  reason: string;
  pause_non_critical: boolean;
  updated_at: string;
}

export interface ErrorFingerprint {
  fingerprint: string;
  event_type: string | null;
  table_name: string | null;
  occurrences: number;
  affected_users: number;
  first_seen: string;
  last_seen: string;
  sample_message: string | null;
}

export interface RemediationRule {
  id: string;
  signature_pattern: string;
  event_type_filter: string | null;
  remediation_function: string;
  description: string;
  enabled: boolean;
  cooldown_seconds: number;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  run_count: number;
  success_count: number;
}

export interface EmailQueueStat {
  queue_name: string;
  queued: number;
  ready: number;
  delayed_or_inflight: number;
  max_attempts: number;
  oldest_enqueued_at: string | null;
  archived_last_24h: number;
}

export interface EmailDeliveryTotals {
  total: number;
  sent: number;
  failed: number;
  pending: number;
  suppressed: number;
  bounced: number;
  complained: number;
}

export interface EmailPipelineLog {
  message_id: string;
  template_name: string;
  recipient_email: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

export interface EmailPipelineError {
  error_message: string;
  status: string;
  occurrences: number;
  last_seen: string;
}

export interface EmailPipelineHealth {
  generated_at: string;
  window_hours: number;
  health: { status: "healthy" | "degraded" | "overloaded"; reason: string };
  send_state: {
    retry_after_until: string | null;
    batch_size: number;
    send_delay_ms: number;
    auth_email_ttl_minutes: number;
    transactional_email_ttl_minutes: number;
    updated_at: string;
  } | null;
  queue_stats: EmailQueueStat[];
  delivery_totals: EmailDeliveryTotals;
  recent_errors: EmailPipelineError[];
  recent_logs: EmailPipelineLog[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export const SystemHealthService = {
  async getHealth(): Promise<SystemHealthState | null> {
    const { data, error } = await sb
      .from("system_health_state")
      .select("status, reason, pause_non_critical, updated_at")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw error;
    return (data as SystemHealthState | null) ?? null;
  },

  async getTopErrors(hours = 24, limit = 10): Promise<ErrorFingerprint[]> {
    const { data, error } = await sb.rpc("get_top_error_fingerprints", {
      p_hours: hours,
      p_limit: limit,
    });
    if (error) throw error;
    return (data as ErrorFingerprint[]) ?? [];
  },

  async getRemediations(): Promise<RemediationRule[]> {
    const { data, error } = await sb
      .from("system_remediations")
      .select("*")
      .order("description", { ascending: true });
    if (error) throw error;
    return (data as RemediationRule[]) ?? [];
  },

  async setRemediationEnabled(id: string, enabled: boolean): Promise<void> {
    const { error } = await sb
      .from("system_remediations")
      .update({ enabled })
      .eq("id", id);
    if (error) throw error;
  },

  async runRemediationsNow(): Promise<{ ran: number }> {
    const { data, error } = await sb.rpc("run_auto_remediations");
    if (error) throw error;
    return (data as { ran: number }) ?? { ran: 0 };
  },

  async getEmailPipelineHealth(hours = 24, limit = 50): Promise<EmailPipelineHealth> {
    const { data, error } = await sb.rpc("get_email_pipeline_health", {
      p_hours: hours,
      p_limit: limit,
    });
    if (error) throw error;
    return data as EmailPipelineHealth;
  },

  async getFreescoutHealth(): Promise<FreescoutHealth> {
    const { data, error } = await supabase.functions.invoke("freescout-health", { method: "GET", timeout: 5000 });
    if (error) {
      return {
        configured: false,
        reachable: false,
        mailboxId: 0,
        reason: "unknown",
        detail: error.message ?? "Could not reach the health probe",
      };
    }
    return data as FreescoutHealth;
  },
};

export interface FreescoutHealth {
  configured: boolean;
  reachable: boolean;
  mailboxId: number;
  latencyMs?: number;
  reason?: string;
  detail?: string;
}
