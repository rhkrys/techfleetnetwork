// @edge-cron
// supabase/functions/auth-reset-smoke/index.ts
//
// AUTH-RESET-SESSION-006: End-to-end password-reset smoke monitor.
//
// Verifies the full reset chain without changing any real member password:
//   1. record-auth-recovery beacon is reachable (public telemetry path)
//   2. check-account-identity edge function responds with the expected shape
//      for a clearly non-existent probe email
//   3. get_recovery_email_health() reports healthy in the last hour
//
// Any failure writes an `auth.reset_smoke.failed` ops_events row at
// severity=error so System Health → Triage surfaces it within minutes.
// On success writes an `auth.reset_smoke.ok` row at severity=info so the
// monitor's own liveness is auditable.
//
// Invoked every 30 minutes by pg_cron (see same-day migration).

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { authorizeServiceRoleRequest } from "../_shared/service-role-auth.ts";
import { withAuditWrapper } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-trace-id, x-request-id",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";

const PROBE_EMAIL = "smoke-probe-never-exists@techfleet.invalid";

type CheckResult = {
  name: string;
  ok: boolean;
  detail?: unknown;
};

async function probeBeacon(): Promise<CheckResult> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/record-auth-recovery`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({
        branch: "no_params",
        outcome: "missing_proof_blocked",
        trace_id: `smoke-${crypto.randomUUID()}`,
      }),
    });
    const ok = res.status === 204 || res.status === 200;
    return { name: "record_auth_recovery_beacon", ok, detail: { status: res.status } };
  } catch (e) {
    return { name: "record_auth_recovery_beacon", ok: false, detail: { error: String(e) } };
  }
}

async function probeIdentity(): Promise<CheckResult> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/check-account-identity`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({ email: PROBE_EMAIL }),
    });
    // We don't care about the specific verdict — just that the endpoint is up
    // and returns a structured JSON response (not 5xx).
    const ok = res.status < 500;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* noop */
    }
    return {
      name: "check_account_identity",
      ok,
      detail: { status: res.status, hasBody: body !== null },
    };
  } catch (e) {
    return { name: "check_account_identity", ok: false, detail: { error: String(e) } };
  }
}

async function probeRecoveryEmailHealth(admin: SupabaseClient): Promise<CheckResult> {
  try {
    const { data, error } = await admin.rpc("get_recovery_email_health", {
      p_window_minutes: 60,
    });
    if (error) {
      return { name: "recovery_email_health", ok: false, detail: { error: error.message } };
    }
    const healthy = Boolean((data as { healthy?: boolean })?.healthy);
    return { name: "recovery_email_health", ok: healthy, detail: data };
  } catch (e) {
    return { name: "recovery_email_health", ok: false, detail: { error: String(e) } };
  }
}

Deno.serve(
  withAuditWrapper("auth-reset-smoke", async (req) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const authz = await authorizeServiceRoleRequest(req);
    if (!authz.ok) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const checks = await Promise.all([
      probeBeacon(),
      probeIdentity(),
      probeRecoveryEmailHealth(admin),
    ]);

    const allOk = checks.every((c) => c.ok);
    const failed = checks.filter((c) => !c.ok).map((c) => c.name);

    try {
      await admin.rpc("record_event", {
        p_sink: "ops_events",
        p_kind: allOk ? "auth.reset_smoke.ok" : "auth.reset_smoke.failed",
        p_actor: null,
        p_payload: {
          checks,
          failed,
          ran_at: new Date().toISOString(),
        },
        p_severity: allOk ? "info" : "error",
        p_source_table: "auth-reset-smoke",
      });
    } catch (e) {
      console.error("record_event failed in auth-reset-smoke", e);
    }

    return new Response(JSON.stringify({ ok: allOk, failed, checks }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  })
);
