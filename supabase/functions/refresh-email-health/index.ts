// @edge-cron
// Refreshes the email_health_snapshot materialized view and rolls up
// 7-day complaint / bounce rates into email_domain_health. Auto-pauses
// bulk sending if complaint rate > 0.1% or bounce rate > 2% (Phase 3.3 / 5.3).
// Runs every 15 min via pg_cron.
import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchWithTimeout } from "../_shared/fetch-timeout.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    return new Response(JSON.stringify({ error: "Server config error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${key}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(url, key);

  // 1. Refresh the snapshot MV (best-effort).
  const { error: refreshErr } = await supabase.rpc("refresh_email_health_snapshot");
  if (refreshErr) {
    console.error("refresh_email_health_snapshot failed", refreshErr);
  }

  // 2. Compute 7-day rolling rates from email_send_log (dedup by message_id).
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: rates, error: ratesErr } = await supabase.rpc("compute_email_domain_health", {
    p_since: since,
  });

  if (ratesErr) {
    console.error("compute_email_domain_health failed", ratesErr);
    return new Response(JSON.stringify({ error: ratesErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const row = Array.isArray(rates) && rates.length > 0 ? rates[0] : null;
  if (!row) {
    return new Response(JSON.stringify({ ok: true, empty: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  await supabase.from("email_domain_health").insert({
    window_start: since,
    window_end: new Date().toISOString(),
    sent: row.sent ?? 0,
    bounced: row.bounced ?? 0,
    complained: row.complained ?? 0,
    complaint_rate: row.complaint_rate ?? 0,
    bounce_rate: row.bounce_rate ?? 0,
  });

  // 3. Auto-pause if rates breach thresholds + alert Discord/admins on transition.
  const complaintRate = Number(row.complaint_rate ?? 0);
  const bounceRate = Number(row.bounce_rate ?? 0);
  const warnThreshold = complaintRate > 0.0005 || bounceRate > 0.01;
  const shouldPause = complaintRate > 0.001 || bounceRate > 0.02;

  const { data: currentState } = await supabase
    .from("email_send_state")
    .select("bulk_paused")
    .eq("id", 1)
    .maybeSingle();
  const wasPaused = currentState?.bulk_paused === true;

  const webhookUrl = Deno.env.get("DISCORD_PROJECT_UPDATES_WEBHOOK");

  if (shouldPause && !wasPaused) {
    await supabase
      .from("email_send_state")
      .update({ bulk_paused: true, updated_at: new Date().toISOString() })
      .eq("id", 1);
    console.warn("Bulk email auto-paused", { complaintRate, bounceRate });

    try {
      await supabase.rpc("notify_admins", {
        p_title: "Bulk email auto-paused",
        p_body: `Complaint rate ${(complaintRate * 100).toFixed(3)}% / bounce rate ${(bounceRate * 100).toFixed(2)}% breached safe thresholds. Review System Health → Deliverability.`,
        p_link: "/admin/system-health?tab=deliverability",
        p_severity: "critical",
      });
    } catch (e) {
      console.error("notify_admins RPC missing or failed", e);
    }

    if (webhookUrl) {
      try {
        await fetchWithTimeout(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            embeds: [
              {
                title: "🚨 Bulk email auto-paused",
                description: `Complaint rate **${(complaintRate * 100).toFixed(3)}%** · Bounce rate **${(bounceRate * 100).toFixed(2)}%**\n7-day window · ${row.sent} sent`,
                color: 0xeb4f26,
                timestamp: new Date().toISOString(),
              },
            ],
          }),
        });
      } catch (e) {
        console.error("Discord alert failed", e);
      }
    }
  } else if (warnThreshold && !shouldPause && webhookUrl) {
    try {
      await fetchWithTimeout(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [
            {
              title: "⚠️ Email deliverability warning",
              description: `Complaint rate **${(complaintRate * 100).toFixed(3)}%** · Bounce rate **${(bounceRate * 100).toFixed(2)}%**\nApproaching auto-pause thresholds.`,
              color: 0xf59e0b,
              timestamp: new Date().toISOString(),
            },
          ],
        }),
      });
    } catch (e) {
      console.error("Discord warning failed", e);
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      sent: row.sent,
      complaintRate,
      bounceRate,
      warned: warnThreshold,
      paused: shouldPause,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
