// @edge-cron
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { withAuditWrapper } from "../_shared/audit.ts";
import { escapeHtml } from "../_shared/escape-html.ts";
import { wasDelivered } from "../_shared/nudge-delivery.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NUDGE_INTERVAL_DAYS = 7;
const INACTIVITY_THRESHOLD_DAYS = 7;
const APP_URL = "https://techfleet.network";

type Candidate = {
  selection_id: string;
  user_id: string;
  path_id: string;
  path_title: string;
  path_slug: string;
  total_steps: number;
  completed_count: number;
  email: string | null;
  first_name: string | null;
  display_name: string | null;
  notify_announcements: boolean | null;
};

Deno.serve(
  withAuditWrapper("quest-nudge", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const authHeader = req.headers.get("Authorization");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!authHeader || authHeader !== `Bearer ${serviceKey}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
    const now = new Date();

    try {
      // Wave 1 PERF-W1-005: collapse the 7×N round-trip per-user fan-out into
      // a single SECURITY DEFINER RPC. ~99% reduction in DB traffic per tick.
      const { data: candidates, error } = await supabase.rpc("get_nudgeable_quest_users", {
        p_inactivity_days: INACTIVITY_THRESHOLD_DAYS,
        p_nudge_interval_days: NUDGE_INTERVAL_DAYS,
      });

      if (error) {
        console.error("get_nudgeable_quest_users failed:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const rows = (candidates ?? []) as Candidate[];
      if (rows.length === 0) {
        return new Response(JSON.stringify({ nudged: 0, message: "No inactive users to nudge" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let nudgedCount = 0;
      for (const c of rows) {
        if (!c.email) continue;
        const firstName = c.first_name || c.display_name || undefined;
        const questUrl = `${APP_URL}/my-journey/quest/${c.path_id}`;
        // T-D: path_title is teacher-controlled; escape before it lands in the
        // notification title / body_html (the render path trusts stored HTML).
        const safeTitle = escapeHtml(c.path_title);

        const { error: notifErr } = await supabase.from("notifications").insert({
          user_id: c.user_id,
          title: `Pick back up: ${safeTitle}`,
          body_html: `<p>You haven't made progress on <strong>${safeTitle}</strong> in a while. Even 15 minutes adds up — jump back in!</p>`,
          notification_type: "quest_nudge",
          link_url: `/my-journey/quest/${c.path_id}`,
        });
        if (notifErr) console.error(`notif insert failed for ${c.user_id}:`, notifErr);

        // T-F: functions.invoke resolves with { error } on non-2xx (does NOT
        // throw), so detect a failed email via the returned error, not only the
        // catch.
        const emailAttempted = !!c.notify_announcements;
        let emailOk = false;
        if (emailAttempted) {
          try {
            const { error: emailErr } = await supabase.functions.invoke(
              "send-transactional-email",
              {
                body: {
                  templateName: "quest-nudge",
                  recipientEmail: c.email,
                  idempotencyKey: `quest-nudge-${c.selection_id}-${now.toISOString().slice(0, 10)}`,
                  templateData: {
                    firstName,
                    questTitle: c.path_title,
                    completedSteps: c.completed_count,
                    totalSteps: c.total_steps,
                    questUrl,
                  },
                },
              }
            );
            if (emailErr) {
              console.error(`nudge email failed for ${c.email}:`, emailErr);
            } else {
              emailOk = true;
            }
          } catch (emailErr) {
            console.error(`nudge email threw for ${c.email}:`, emailErr);
          }
        }

        // T-F: last_nudged_at suppresses re-nudging for NUDGE_INTERVAL_DAYS. Only
        // advance it when the nudge actually reached the user on some channel —
        // otherwise a failed insert + failed email silently suppresses the user
        // for the whole window despite never being nudged.
        if (!wasDelivered({ inAppOk: !notifErr, emailAttempted, emailOk })) {
          continue;
        }

        await supabase
          .from("user_quest_selections")
          .update({ last_nudged_at: now.toISOString() })
          .eq("id", c.selection_id);

        nudgedCount++;
      }

      console.log(`Quest nudge complete: ${nudgedCount} nudged / ${rows.length} candidates`);
      return new Response(JSON.stringify({ nudged: nudgedCount, candidates: rows.length }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("Quest nudge error:", err);
      return new Response(JSON.stringify({ error: "Internal error processing nudges" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  })
);
