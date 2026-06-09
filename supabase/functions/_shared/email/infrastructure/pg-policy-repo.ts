import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { PolicyRepo } from '../ports.ts';
import { DEFAULT_POLICY, type PolicyConfig } from '../domain/types.ts';

let cache: { at: number; cfg: PolicyConfig } | null = null;
const TTL_MS = 30_000;

export function makePgPolicyRepo(supabase: SupabaseClient): PolicyRepo {
  return {
    async load() {
      if (cache && Date.now() - cache.at < TTL_MS) return cache.cfg;
      const { data, error } = await supabase.from('email_policy_config').select('*').eq('id', 1).maybeSingle();
      if (error || !data) { cache = { at: Date.now(), cfg: DEFAULT_POLICY }; return DEFAULT_POLICY; }
      const cfg: PolicyConfig = {
        baseBackoffSeconds: data.base_backoff_seconds,
        maxBackoffSeconds: data.max_backoff_seconds,
        workspaceQuotaCapSeconds: data.workspace_quota_cap_seconds,
        cbOpenThreshold429s: data.cb_open_threshold_429s,
        cbOpenWindowSeconds: data.cb_open_window_seconds,
        cbHalfOpenProbeSeconds: data.cb_half_open_probe_seconds,
        cbCloseSuccessThreshold: data.cb_close_success_threshold,
        maxBatchSize: data.max_batch_size,
        minSendGapMs: data.min_send_gap_ms,
        pendingExpiryMinutes: data.pending_expiry_minutes,
        authPendingExpiryMinutes: data.auth_pending_expiry_minutes,
      };
      cache = { at: Date.now(), cfg };
      return cfg;
    },
  };
}
