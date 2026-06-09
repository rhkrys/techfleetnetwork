/**
 * Login telemetry — fire-and-forget event recorder.
 *
 * Every login attempt generates one `attempt_id` and emits events at each
 * stage (started, captcha_loaded, edge_entered, redirected, …) plus any
 * failure branch. Events are written via the `record_login_event` RPC
 * which hashes email/IP server-side. Never blocks UX. Never throws.
 */
import { supabase } from "@/integrations/supabase/client";

export type LoginOutcome =
  | "started"
  | "captcha_loaded"
  | "captcha_blocked"
  | "captcha_failed"
  | "edge_entered"
  | "domain_reject"
  | "auth_throttle"
  | "invalid_credentials"
  | "session_set"
  | "mfa_required"
  | "redirected"
  | "session_incomplete"
  | "client_session_write_failed"
  | "network_error"
  | "server_error"
  | "stale_chunk_recovery"
  | "magic_link_sent"
  | "magic_link_failed"
  | "unknown";

export interface LoginEventExtra {
  branch?: string | null;
  httpStatus?: number | null;
  durationMs?: number | null;
  email?: string | null;
  requestId?: string | null;
  userId?: string | null;
}

const PENDING_KEY = "tfn_login_stale_chunk_pending";

export function newAttemptId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function originHost(): string | undefined {
  try {
    return window.location.hostname;
  } catch {
    return undefined;
  }
}

function uaShort(): string | undefined {
  try {
    return navigator.userAgent.slice(0, 120);
  } catch {
    return undefined;
  }
}

export function recordLoginEvent(
  attemptId: string,
  outcome: LoginOutcome,
  extra: LoginEventExtra = {},
): void {
  try {
    // Fire-and-forget; never await, never throw.
    void supabase
      .rpc("record_login_event", {
        p_attempt_id: attemptId,
        p_outcome: outcome,
        p_branch: extra.branch ?? null,
        p_http_status: extra.httpStatus ?? null,
        p_duration_ms: extra.durationMs ?? null,
        p_email: extra.email ?? null,
        p_ip: null,
        p_user_agent: uaShort() ?? null,
        p_origin_host: originHost() ?? null,
        p_request_id: extra.requestId ?? null,
        p_user_id: extra.userId ?? null,
      })
      .then(() => undefined, () => undefined);
  } catch {
    /* never bubble telemetry errors */
  }
}

/**
 * Pre-mount stale-chunk reloader (in index.html) sets a sessionStorage marker
 * before redirecting. On the next mount, flush that marker as a real login
 * telemetry event so admins can see how often the recovery path fires.
 */
export function flushPendingStaleChunkEvent(): void {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PENDING_KEY);
    const attemptId = raw || newAttemptId();
    recordLoginEvent(attemptId, "stale_chunk_recovery");
  } catch {
    /* storage blocked */
  }
}

export function markStaleChunkPending(): void {
  try {
    sessionStorage.setItem(PENDING_KEY, newAttemptId());
  } catch {
    /* storage blocked */
  }
}
