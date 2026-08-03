// @edge-cron
// Email subsystem v2 — single dispatcher edge fn. Replaces process-email-queue
// once email_send_state.pipeline_v2_lanes_bitmask = 7 (all lanes on) and the
// 72h soak gate passes. Until then it runs in parallel; legacy senders that
// haven't been migrated continue to enqueue into pgmq.
import { withAuditWrapper } from "../_shared/audit.ts";
import { authorizeServiceRoleRequest } from "../_shared/service-role-auth.ts";
import { buildEmailContainer } from "../_shared/email/composition.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-trace-id, x-request-id",
};

Deno.serve(
  withAuditWrapper("email-dispatcher", async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    const auth = await authorizeServiceRoleRequest(req);
    if (!auth.ok)
      return new Response(JSON.stringify({ error: auth.error }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const { dispatchDue, outbox } = buildEmailContainer();
    // GC first — cheap and keeps stale 'pending' from polluting dashboards.
    const expired = await outbox.gcExpired().catch(() => 0);
    const result = await dispatchDue();
    return new Response(JSON.stringify({ ok: true, expired, ...result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  })
);
