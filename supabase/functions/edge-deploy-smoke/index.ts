// @edge-cron
// edge-deploy-smoke
// Probes every edge function listed in supabase/functions.manifest.json with
// an OPTIONS request. A 404 means the platform stopped shipping it. On 404 we write a
// severity:error row to audit_log which the existing Triage Critical Push
// (5-min cron) pages admins on within minutes.
//
// Runs on a 10-min cron, service-role authed.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { authorizeServiceRoleRequest } from "../_shared/service-role-auth.ts";
import { auditEdgeEvent } from "../_shared/audit.ts";
import { buildNotDeployedAuditEvent } from "./alerts.ts";
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
  const results: Array<{ name: string; status: number; ok: boolean }> = [];
  const notDeployed: string[] = [];

  // 8-way concurrency
  const queue = [...FUNCTIONS];
  async function worker() {
    while (queue.length) {
      const fn = queue.shift();
      if (!fn) break;
      // Skip self to avoid recursion
      if (fn.name === "edge-deploy-smoke") continue;
      try {
        const r = await fetch(`${base}/${fn.name}`, {
          method: "OPTIONS",
          headers: { "access-control-request-method": "POST" },
          signal: AbortSignal.timeout(5000),
        });
        await r.body?.cancel();
        const ok = r.status !== 404;
        results.push({ name: fn.name, status: r.status, ok });
        if (!ok) notDeployed.push(fn.name);
      } catch (e) {
        results.push({ name: fn.name, status: 0, ok: false });
        notDeployed.push(fn.name);
      }
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
      ok: notDeployed.length === 0,
    }),
    { headers: { ...corsHeaders, "content-type": "application/json" } }
  );
});
