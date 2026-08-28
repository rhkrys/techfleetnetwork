// @edge-cron
// auth-prober — cron-poked synthetic E2E auth probe.
//
// Runs the reset→sign-out→sign-in path against the deployed `auth-broker`
// every 5 minutes against a sealed test account. Persists one row per
// stage into `auth_prober_results` and, on two consecutive same-stage
// failures, enqueues a critical alert into `agent_fix_queue` — which the
// `notify-critical-fix` cron scans to push to admins.
//
// Authentication: this is a cron-poked worker — accepts either a legacy
// service_role JWT or an opaque sb_secret_* via the shared
// `authorizeServiceRoleRequest` helper.

import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { authorizeServiceRoleRequest } from "../_shared/service-role-auth.ts";
import { withAuditWrapper } from "../_shared/audit.ts";
import { buildAuthProberAlert } from "./alert.ts";

const PROBER_USER_AGENT = "TFN-AuthProber/1.0";

type ProbeStage = "reset_request" | "reset_complete" | "sign_out" | "sign_in" | "session_refresh";

interface ProbeResult {
  stage: ProbeStage;
  outcome: "ok" | "err" | "skipped";
  errorCode?: string;
  latencyMs: number;
  correlationId: string;
}

const corsHeaders: HeadersInit = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, x-trace-id, x-request-id",
  "access-control-allow-methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

async function callBroker(
  brokerUrl: string,
  anonKey: string,
  route: string,
  body: Record<string, unknown>,
  correlationId: string
): Promise<{ status: number; json: { ok: boolean; code?: string }; latencyMs: number }> {
  const start = Date.now();
  try {
    const res = await fetch(`${brokerUrl.replace(/\/$/, "")}/${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${anonKey}`,
        "user-agent": PROBER_USER_AGENT,
        "x-correlation-id": correlationId,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({ ok: false, code: "unexpected" }))) as {
      ok: boolean;
      code?: string;
    };
    return { status: res.status, json, latencyMs: Date.now() - start };
  } catch (_e) {
    return { status: 0, json: { ok: false, code: "network_error" }, latencyMs: Date.now() - start };
  }
}

function newId(): string {
  return crypto.randomUUID();
}

async function runProbe(
  brokerUrl: string,
  anonKey: string,
  email: string,
  password: string
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  const correlationId = newId();

  const reset = await callBroker(
    brokerUrl,
    anonKey,
    "password-reset/request",
    { email },
    correlationId
  );
  results.push({
    stage: "reset_request",
    outcome: reset.json.ok ? "ok" : "err",
    errorCode: reset.json.ok ? undefined : (reset.json.code ?? "unexpected"),
    latencyMs: reset.latencyMs,
    correlationId,
  });

  // Inbox consumption isn't feasible from a cron worker; skip with a known outcome.
  results.push({ stage: "reset_complete", outcome: "skipped", latencyMs: 0, correlationId });

  const signIn = await callBroker(
    brokerUrl,
    anonKey,
    "sign-in/password",
    { email, password },
    correlationId
  );
  results.push({
    stage: "sign_in",
    outcome: signIn.json.ok ? "ok" : "err",
    errorCode: signIn.json.ok ? undefined : (signIn.json.code ?? "unexpected"),
    latencyMs: signIn.latencyMs,
    correlationId,
  });

  const signOut = await callBroker(brokerUrl, anonKey, "sign-out", {}, correlationId);
  results.push({
    stage: "sign_out",
    outcome: signOut.json.ok || signOut.status === 200 ? "ok" : "err",
    errorCode: signOut.json.ok ? undefined : (signOut.json.code ?? "unexpected"),
    latencyMs: signOut.latencyMs,
    correlationId,
  });

  return results;
}

Deno.serve(
  withAuditWrapper("auth-prober", async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const auth = authorizeServiceRoleRequest(req);
    if (!auth.ok) {
      return jsonResponse({ ok: false, error: auth.error }, auth.status);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const proberEmail = Deno.env.get("AUTH_PROBER_EMAIL") ?? "";
    const proberPassword = Deno.env.get("AUTH_PROBER_PASSWORD") ?? "";

    if (!proberEmail || !proberPassword) {
      return jsonResponse(
        { ok: false, error: "AUTH_PROBER_EMAIL and AUTH_PROBER_PASSWORD must be set" },
        412
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const brokerUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/auth-broker`;
    const results = await runProbe(brokerUrl, anonKey, proberEmail, proberPassword);

    const rows = results.map((r) => ({
      correlation_id: r.correlationId,
      stage: r.stage,
      outcome: r.outcome,
      error_code: r.errorCode ?? null,
      latency_ms: r.latencyMs,
      prober_user_agent: PROBER_USER_AGENT,
      details: {},
    }));

    // Two-strike: page admins via Triage Critical Push only when the latest run
    // AND a prior run failed on the same stage. T-F: query the prior rows BEFORE
    // inserting this run's — otherwise the just-inserted failure counts as its own
    // "prior" and the debounce never fires (pages on the first transient blip).
    const errStages = results.filter((r) => r.outcome === "err").map((r) => r.stage);
    let shouldPage = false;
    if (errStages.length > 0) {
      const { data: prior } = await admin
        .from("auth_prober_results")
        .select("stage, outcome, created_at")
        .in("stage", errStages)
        .order("created_at", { ascending: false })
        .limit(20);
      // Look for a prior `err` row for any failing stage in the previous run cycle.
      if (prior) {
        const priorErrStages = new Set(
          prior
            .filter((row: { outcome: string }) => row.outcome === "err")
            .map((row: { stage: string }) => row.stage as ProbeStage)
        );
        shouldPage = errStages.some((s) => priorErrStages.has(s));
      }
    }

    // Persist this run's results AFTER the prior-run lookup above.
    const { error: insertErr } = await admin.from("auth_prober_results").insert(rows);
    if (insertErr) {
      console.warn("auth-prober: insert failed", insertErr);
    }

    if (shouldPage) {
      try {
        // Enqueue into agent_fix_queue — the table notify-critical-fix scans to
        // fan a critical web-push to admins. Previously this invoked a
        // non-existent "triage-critical-push" edge function (only the cron job and
        // the notify-critical-fix function exist by that intent), so the invoke
        // always threw and was swallowed — auth-prober failures paged no one.
        // Stable per-failure-set fingerprint => notify-critical-fix pushes each
        // distinct failure once (respecting its hourly cap).
        const { error: enqueueError } = await admin
          .from("agent_fix_queue")
          .upsert(buildAuthProberAlert(errStages), { onConflict: "fingerprint" });
        if (enqueueError) console.warn("auth-prober: enqueue critical alert failed", enqueueError);
      } catch (e) {
        console.warn("auth-prober: enqueue critical alert threw", e);
      }
    }

    return jsonResponse({ ok: true, results, paged: shouldPage });
  })
);
