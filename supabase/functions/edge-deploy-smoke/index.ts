// @edge-cron
// edge-deploy-smoke
// Liveness-probes every edge function in the manifest. Classification is
// reliability-hardened (see probe.ts) after INCIDENT
// edge-deploy-smoke-false-alarms-2026-08, where an OPTIONS-only probe that
// treated any 404 OR any fetch timeout as "not deployed" emitted 36,270 false
// severity:error rows and libeled the live handoff-worker. Only a CONFIRMED
// missing function (a JWT-gated function whose gateway returns 404) writes the
// severity:error row that the Triage Critical Push (5-min cron) pages on.
// Ambiguous signals (a verify_jwt=false function that doesn't answer OPTIONS,
// or a transient timeout) are reported as `inconclusive` and never page.
//
// Runs on a 10-min cron, service-role authed.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { authorizeServiceRoleRequest } from "../_shared/service-role-auth.ts";
import { auditEdgeEvent } from "../_shared/audit.ts";
import { buildNotDeployedAuditEvent } from "./alerts.ts";
import { classifyProbe, probeMethodFor, type ProbeVerdict } from "./probe.ts";
import manifest from "./_manifest.json" with { type: "json" };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface FnEntry {
  name: string;
  verify_jwt: boolean;
}
const FUNCTIONS: FnEntry[] = (manifest as { functions: FnEntry[] }).functions;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = authorizeServiceRoleRequest(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const base = `${SUPABASE_URL}/functions/v1`;
  const results: Array<{ name: string; status: number; verdict: ProbeVerdict }> = [];
  const notDeployed: string[] = [];
  const inconclusive: string[] = [];

  // 8-way concurrency
  const queue = [...FUNCTIONS];
  async function worker() {
    while (queue.length) {
      const fn = queue.shift();
      if (!fn) break;
      // Skip self to avoid recursion
      if (fn.name === "edge-deploy-smoke") continue;
      // Side-effect-free probe chosen by auth gate; reliable classification in
      // probe.ts (INCIDENT edge-deploy-smoke-false-alarms-2026-08).
      const method = probeMethodFor(fn.verify_jwt);
      let status: number;
      try {
        const r = await fetch(`${base}/${fn.name}`, {
          method,
          headers: method === "OPTIONS" ? { "access-control-request-method": "POST" } : {},
          signal: AbortSignal.timeout(5000),
        });
        await r.body?.cancel();
        status = r.status;
      } catch (_e) {
        status = 0; // fetch threw / timed out — transient, NOT evidence of removal
      }
      const verdict = classifyProbe(status, fn.verify_jwt);
      results.push({ name: fn.name, status, verdict });
      if (verdict === "missing") notDeployed.push(fn.name);
      else if (verdict === "inconclusive") inconclusive.push(fn.name);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));

  // Page on any 404 via the canonical audit pipeline. auditEdgeEvent writes a
  // severity:error audit_log row (correct text[] `changed_fields` schema) that
  // the triage promotion lifts into agent_fix_queue — the table notify-critical-fix
  // actually scans. The prior raw insert used non-existent columns and was never
  // checked, so this safety net was itself silent (audit H14).
  for (const name of notDeployed) {
    await auditEdgeEvent(admin, buildNotDeployedAuditEvent(name));
  }

  return new Response(
    JSON.stringify({
      checked: results.length,
      not_deployed: notDeployed,
      inconclusive,
      ok: notDeployed.length === 0,
    }),
    { headers: { ...corsHeaders, "content-type": "application/json" } }
  );
});
