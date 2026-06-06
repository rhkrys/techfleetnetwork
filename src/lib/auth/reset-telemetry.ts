/**
 * Public, no-PII reset telemetry beacon.
 *
 * Why this exists: the prior diagnostic write went through `write_audit_log`,
 * which REQUIRES an authenticated session. When the bug is "the recovery
 * session never materialized", that diagnostic silently fails — which is
 * exactly why several reset-page failures left no trace in logs.
 *
 * This helper beacons to a public edge function (`record-auth-recovery`) that
 * accepts only enum-validated fields. It never sends tokens, emails,
 * passwords, full URLs, or any user input.
 */

const ENDPOINT = "/functions/v1/record-auth-recovery";

export type ResetBranch =
  | "token_hash"
  | "code"
  | "hash"
  | "session_event"
  | "no_params"
  | "timeout"
  | "update_submit";

export type ResetOutcome =
  | "ok"
  | "no_session_returned"
  | "verify_error"
  | "exchange_error"
  | "set_session_error"
  | "get_user_error"
  | "update_session_expired"
  | "update_service_unavailable"
  | "update_rate_limited"
  | "update_same_password"
  | "update_weak_password"
  | "update_unknown_error"
  | "update_success"
  | "missing_proof_blocked";

interface ResetTelemetryPayload {
  branch: ResetBranch;
  outcome: ResetOutcome;
  has_token_hash?: boolean;
  has_code?: boolean;
  has_hash?: boolean;
  release_tag?: string;
}

function getSupabaseBase(): string | null {
  try {
    const url =
      (import.meta as unknown as { env?: Record<string, string> }).env
        ?.VITE_SUPABASE_URL ?? null;
    return url ?? null;
  } catch {
    return null;
  }
}

function getAnonKey(): string | null {
  try {
    return (
      (import.meta as unknown as { env?: Record<string, string> }).env
        ?.VITE_SUPABASE_PUBLISHABLE_KEY ?? null
    );
  } catch {
    return null;
  }
}

export function recordResetTelemetry(payload: ResetTelemetryPayload): void {
  const base = getSupabaseBase();
  const key = getAnonKey();
  if (!base || !key) return;

  const body = JSON.stringify({
    branch: payload.branch,
    outcome: payload.outcome,
    has_token_hash: Boolean(payload.has_token_hash),
    has_code: Boolean(payload.has_code),
    has_hash: Boolean(payload.has_hash),
    release_tag: payload.release_tag ?? null,
  });

  const url = `${base}${ENDPOINT}`;
  try {
    // sendBeacon survives navigation away (e.g. "Request a new link" click).
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon(url, blob);
      if (ok) return;
    }
    // Fallback fetch — keepalive so it survives unload.
    void fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body,
      keepalive: true,
    }).catch(() => {
      /* telemetry is best-effort */
    });
  } catch {
    /* telemetry must never block recovery */
  }
}
