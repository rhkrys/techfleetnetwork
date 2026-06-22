import { supabase } from "@/integrations/supabase/client";
import { retryPostgrest } from "@/lib/data/transient-retry";

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

export interface EmailReconcilerStatus {
  stuck_pending: number;
  last_run_at: string | null;
  last_run: { reconciled_terminal: number; requeued: number; dlq_lost: number; marked_dlq?: number; left_in_queue: number; checked: number } | null;
  last_severity: "info" | "warn" | "error" | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export const SystemHealthService = {
  async getHealth(): Promise<SystemHealthState | null> {
    const { data, error } = await retryPostgrest(() =>
      sb
        .from("system_health_state")
        .select("status, reason, pause_non_critical, updated_at")
        .eq("id", 1)
        .maybeSingle()
    );
    if (error) throw error;
    return (data as SystemHealthState | null) ?? null;
  },

  async getTopErrors(hours = 24, limit = 10): Promise<ErrorFingerprint[]> {
    const { data, error } = await retryPostgrest(() =>
      sb.rpc("get_top_error_fingerprints", { p_hours: hours, p_limit: limit })
    );
    if (error) throw error;
    return (data as ErrorFingerprint[]) ?? [];
  },

  async getRemediations(): Promise<RemediationRule[]> {
    const { data, error } = await retryPostgrest(() =>
      sb.from("system_remediations").select("*").order("description", { ascending: true })
    );
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
    const { data, error } = await retryPostgrest(() =>
      sb.rpc("get_email_pipeline_health", { p_hours: hours, p_limit: limit })
    );
    if (error) throw error;
    return data as EmailPipelineHealth;
  },

  async getEmailReconcilerStatus(): Promise<EmailReconcilerStatus> {
    const { data, error } = await retryPostgrest(() =>
      sb.rpc("get_email_reconciler_status")
    );
    if (error) throw error;
    return (data as EmailReconcilerStatus) ?? {
      stuck_pending: 0, last_run_at: null, last_run: null, last_severity: null,
    };
  },

  async getRefactorKpis(days = 30): Promise<RefactorKpi[]> {
    const { data, error } = await retryPostgrest<any[]>(() =>
      sb.rpc("get_refactor_kpis", { p_days: days })
    );
    if (error) throw error;
    return (data ?? []).map((row: any): RefactorKpi => ({
      metric_key: row.metric_key,
      label: row.label,
      description: row.description,
      category: row.category,
      unit: row.unit,
      baseline_value: Number(row.baseline_value),
      target_value: Number(row.target_value),
      direction: row.direction,
      related_section: row.related_section,
      current_value: row.current_value == null ? null : Number(row.current_value),
      previous_value: row.previous_value == null ? null : Number(row.previous_value),
      current_window: null,
      last_updated: row.last_snapshot ?? null,
      trend: Array.isArray(row.trend) ? row.trend.map((v: any) => Number(v)) : [],
      status: row.status,
    }));
  },

  async runRefactorKpisSnapshot(): Promise<number> {
    const { data, error } = await sb.rpc("run_refactor_kpis_snapshot_now");
    if (error) throw error;
    const payload = (data ?? {}) as { ok?: boolean; rows?: number };
    return Number(payload.rows ?? 0);
  },
};

export type RefactorKpiStatus = "met" | "on_track" | "at_risk" | "off_track" | "no_data";

export interface RefactorKpi {
  metric_key: string;
  label: string;
  description: string;
  category: "errors" | "ux" | "email" | "infra" | "auth";
  unit: "percent" | "count" | "minutes" | "ratio" | "seconds";
  baseline_value: number;
  target_value: number;
  direction: "lower_is_better" | "higher_is_better";
  related_section: string;
  current_value: number | null;
  previous_value: number | null;
  current_window: string | null;
  last_updated: string | null;
  trend: number[];
  status: RefactorKpiStatus;
}


