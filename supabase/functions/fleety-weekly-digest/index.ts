// Weekly Fleety Coach digest — emails admins a summary of the past 7 days:
// signal totals, thumbs balance, top playbook gaps, drafts awaiting review.
// Triggered via pg_cron weekly. Auth: service-role required.
import { createClient } from "npm:@supabase/supabase-js@2";
import { queueTransactionalEmail } from "../_shared/transactional-email.ts";

import { withAuditWrapper } from "../_shared/audit.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(withAuditWrapper("fleety-weekly-digest", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Wave 1 SEC-W1-002: enforce the service-role gate the comment already
  // promised. Without it any anon JWT could trigger a fan-out of admin emails.
  const auth = req.headers.get("authorization") ?? "";
  if (!SERVICE_ROLE || auth !== `Bearer ${SERVICE_ROLE}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const today = new Date();
  const weekRange = `${new Date(sevenDaysAgo).toLocaleDateString()} – ${today.toLocaleDateString()}`;

  // Aggregate stats from signals view
  const { data: signals } = await supabase
    .from("fleety_signals_view")
    .select("rating, practical_score, intent, user_query, playbook_hits")
    .gte("created_at", sevenDaysAgo)
    .limit(1000);
  const rows = signals ?? [];
  const totalTurns = rows.length;
  const thumbsUp = rows.filter((r: any) => r.rating === 1).length;
  const thumbsDown = rows.filter((r: any) => r.rating === -1).length;
  const scored = rows.filter((r: any) => r.practical_score != null);
  const practicalScore = scored.length
    ? scored.reduce((s: number, r: any) => s + Number(r.practical_score), 0) / scored.length
    : null;

  // Cluster gaps: operational intents with 0 playbook hits
  const gapMap = new Map<string, number>();
  for (const r of rows as any[]) {
    if (!["how_to", "troubleshoot", "decision"].includes(r.intent)) continue;
    if ((r.playbook_hits ?? 0) > 0) continue;
    const key = (r.user_query || "").trim().toLowerCase().slice(0, 120);
    if (!key) continue;
    gapMap.set(key, (gapMap.get(key) ?? 0) + 1);
  }
  const gaps = Array.from(gapMap.entries())
    .map(([question, count]) => ({ question, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Drafts pending review
  const { data: draftRows } = await supabase
    .from("fleety_playbooks")
    .select("title, slug")
    .eq("is_active", false)
    .order("created_at", { ascending: false })
    .limit(5);
  const drafts = (draftRows ?? []).map((d: any) => ({ title: d.title, slug: d.slug }));

  // Recipients: all admins
  const { data: admins } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin");
  if (!admins || admins.length === 0) {
    return json({ ok: true, sent: 0, reason: "no admins" });
  }
  const adminIds = admins.map((a: any) => a.user_id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, email, first_name")
    .in("user_id", adminIds);

  let sent = 0;
  for (const p of profiles ?? []) {
    if (!p.email) continue;
    const idemKey = `fleety-coach-digest:${p.user_id}:${today.toISOString().slice(0, 10)}`;
    const res = await queueTransactionalEmail({
      templateName: "fleety-coach-digest",
      recipientEmail: p.email,
      idempotencyKey: idemKey,
      supabase,
      templateData: {
        firstName: p.first_name || "Admin",
        weekRange,
        totalTurns,
        thumbsUp,
        thumbsDown,
        practicalScore,
        gaps,
        drafts,
        adminUrl: "https://techfleet.network/admin/system-health",
      },
    });
    if (res.ok) sent += 1;
  }

  return json({ ok: true, sent, totalTurns, thumbsUp, thumbsDown, gaps: gaps.length, drafts: drafts.length });
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
