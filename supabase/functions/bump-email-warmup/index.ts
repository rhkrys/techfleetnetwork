// @edge-cron
// Bumps bulk_hourly_cap on a warm-up schedule (Phase 3.3 of deliverability plan).
// Day 0–14: 50/hr. Day 15–30: 200/hr. Day 31+: 5000/hr (effectively unlimited).
// Runs daily 00:05 UTC via pg_cron.
import { createClient } from "npm:@supabase/supabase-js@2";
import { withAuditWrapper } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(
  withAuditWrapper("bump-email-warmup", async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) {
      return new Response(JSON.stringify({ error: "Server config error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role authorization (called by pg_cron).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || authHeader !== `Bearer ${key}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(url, key);
    const { data: state, error } = await supabase
      .from("email_send_state")
      .select("id, bulk_warmup_started_at, bulk_hourly_cap, bulk_paused")
      .limit(1)
      .single();

    if (error || !state) {
      return new Response(JSON.stringify({ error: error?.message || "no state row" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (state.bulk_paused) {
      return new Response(JSON.stringify({ skipped: true, reason: "paused" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const startedAt = state.bulk_warmup_started_at
      ? new Date(state.bulk_warmup_started_at)
      : new Date();
    const ageDays = Math.floor((Date.now() - startedAt.getTime()) / 86_400_000);
    const targetCap = ageDays >= 31 ? 5000 : ageDays >= 15 ? 200 : 50;

    if (state.bulk_hourly_cap === targetCap && state.bulk_warmup_started_at) {
      return new Response(JSON.stringify({ ok: true, cap: targetCap, ageDays, unchanged: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const updates: Record<string, unknown> = {
      bulk_hourly_cap: targetCap,
      updated_at: new Date().toISOString(),
    };
    if (!state.bulk_warmup_started_at) updates.bulk_warmup_started_at = startedAt.toISOString();

    const { error: updErr } = await supabase
      .from("email_send_state")
      .update(updates)
      .eq("id", state.id);

    if (updErr) {
      return new Response(JSON.stringify({ error: updErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, cap: targetCap, ageDays }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  })
);
