// @edge-cron
import { withAuditWrapper } from "../_shared/audit.ts";
import { authorizeServiceRoleRequest } from "../_shared/service-role-auth.ts";
/**
 * notify-critical-fix
 *
 * Lane 4 immediate push: scans agent_fix_queue for severity='error' fingerprints
 * that haven't pushed yet (per triage_critical_push_log), and fans out a single
 * web push to every admin's subscription.
 *
 * Cost discipline:
 *   - Pure SQL filter, no AI calls
 *   - Each fingerprint pushes at most once (UNIQUE constraint)
 *   - Hard cap: 3 critical pushes per hour platform-wide
 *   - Service-role gated (called by cron only)
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = "https://techfleet.network";
const HOURLY_CAP = 3;

Deno.serve(
  withAuditWrapper("notify-critical-fix", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // Service-role only. Constant-time exact key match; NO unverified JWT decode.
    const svcAuth = authorizeServiceRoleRequest(req);
    if (!svcAuth.ok) return json({ error: "unauthorized" }, svcAuth.status);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Hourly cap check
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentCount } = await supabase
      .from("triage_critical_push_log")
      .select("*", { count: "exact", head: true })
      .gte("pushed_at", hourAgo);
    if ((recentCount ?? 0) >= HOURLY_CAP) {
      return json({ ok: true, skipped: "hourly_cap", recentCount });
    }

    // Find unsent critical fingerprints (severity=error, open status, not snoozed)
    const nowIso = new Date().toISOString();
    const { data: candidates } = await supabase
      .from("agent_fix_queue")
      .select("id,fingerprint,event_type,source,error_message,occurrence_count")
      .eq("severity", "error")
      .in("status", ["pending", "triaged", "proposed"])
      .or(`snoozed_until.is.null,snoozed_until.lt.${nowIso}`)
      .order("occurrence_count", { ascending: false })
      .limit(10);

    if (!candidates?.length) return json({ ok: true, sent: 0 });

    const fps = candidates.map((c) => c.fingerprint);
    const { data: alreadyPushed } = await supabase
      .from("triage_critical_push_log")
      .select("fingerprint")
      .in("fingerprint", fps);
    const sentSet = new Set((alreadyPushed ?? []).map((r) => r.fingerprint));
    const fresh = candidates.filter((c) => !sentSet.has(c.fingerprint));
    const allowance = HOURLY_CAP - (recentCount ?? 0);
    const toSend = fresh.slice(0, allowance);
    if (!toSend.length) return json({ ok: true, sent: 0 });

    // Fetch admin push subscriptions
    const { data: admins } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const adminIds = (admins ?? []).map((a) => a.user_id);
    if (!adminIds.length) return json({ ok: true, sent: 0, reason: "no_admins" });

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("endpoint,p256dh,auth")
      .in("user_id", adminIds);

    let totalSent = 0;
    const url = `${SITE_URL}/admin/system-health?tab=triage`;

    for (const item of toSend) {
      const title = `🚨 Critical error: ${item.event_type}`;
      const body = `${item.error_message.slice(0, 120)} (×${item.occurrence_count})`;
      let recipients = 0;
      for (const s of subs ?? []) {
        try {
          const resp = await fetch(`${SUPABASE_URL}/functions/v1/send-push-notification`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_ROLE}`,
            },
            body: JSON.stringify({
              endpoint: s.endpoint,
              keys: { p256dh: s.p256dh, auth: s.auth },
              title,
              body: body,
              url,
              notification_type: "triage_critical",
            }),
          });
          if (resp.ok) recipients += 1;
        } catch (_e) {
          /* ignore individual failures */
        }
      }
      await supabase.from("triage_critical_push_log").insert({
        fingerprint: item.fingerprint,
        fix_queue_id: item.id,
        recipients_count: recipients,
        reason: `severity=error, occurrences=${item.occurrence_count}`,
      });
      totalSent += 1;
    }

    return json({ ok: true, sent: totalSent });
  })
);

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
