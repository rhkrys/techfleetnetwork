// @edge-auth
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { withAuditWrapper } from "../_shared/audit.ts";
import { wasDelivered } from "../_shared/nudge-delivery.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_URL = "https://techfleet.network";
const STALE_HOURS = 48;

const SECTION_LABELS: Record<number, string> = {
  1: "Basic info",
  2: "Profile",
  3: "Engagement",
  4: "Agile mindset",
  5: "Service leadership",
  6: "Review",
};

Deno.serve(
  withAuditWrapper("resume-application-reminder", async (req) => {
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
    const cutoff = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000).toISOString();

    try {
      // Drafts older than 48h that have never been reminded, with at least
      // some content (current_section > 1 OR any non-empty answer field).
      const { data: drafts, error } = await supabase
        .from("general_applications")
        .select("id, user_id, current_section, updated_at, resume_reminder_sent_at, about_yourself")
        .eq("status", "draft")
        .is("resume_reminder_sent_at", null)
        .lte("updated_at", cutoff)
        .limit(200);

      if (error) {
        console.error("draft fetch failed:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const rows = drafts ?? [];
      if (rows.length === 0) {
        return new Response(JSON.stringify({ reminded: 0 }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userIds = rows.map((r) => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, email, first_name, display_name, notify_announcements")
        .in("user_id", userIds);
      const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p]));

      let reminded = 0;
      for (const d of rows) {
        const p = profileMap.get(d.user_id);
        if (!p?.email) continue;
        // Require at least one section started beyond defaults
        const started = (d.current_section ?? 1) > 1 || (d.about_yourself ?? "").length > 0;
        if (!started) continue;

        const sectionLabel = SECTION_LABELS[d.current_section ?? 1] ?? "your application";
        const firstName = p.first_name || p.display_name || undefined;

        // T-F: functions.invoke resolves with { error } on non-2xx (it does NOT
        // throw), so a failed email must be detected via the returned error — the
        // try/catch only covers a thrown/network exception.
        const emailAttempted = p.notify_announcements !== false;
        let emailOk = false;
        if (emailAttempted) {
          try {
            const { error: emailErr } = await supabase.functions.invoke(
              "send-transactional-email",
              {
                body: {
                  templateName: "resume-application",
                  recipientEmail: p.email,
                  idempotencyKey: `resume-application-${d.id}`,
                  templateData: {
                    firstName,
                    sectionLabel,
                    resumeUrl: `${APP_URL}/applications/general`,
                  },
                },
              }
            );
            if (emailErr) {
              console.error(`resume-application email failed for ${p.email}:`, emailErr);
            } else {
              emailOk = true;
            }
          } catch (emailErr) {
            console.error(`resume-application email threw for ${p.email}:`, emailErr);
          }
        }

        const { error: notifErr } = await supabase.from("notifications").insert({
          user_id: d.user_id,
          title: "Your application is saved",
          body_html: `<p>Your general application is waiting for you. Pick back up on <strong>${sectionLabel}</strong>.</p>`,
          notification_type: "application_reminder",
          link_url: "/applications/general",
        });
        if (notifErr)
          console.error(`resume-application notif insert failed for ${d.user_id}:`, notifErr);

        // T-F: resume_reminder_sent_at is a one-shot gate (fires once ever). Only
        // stamp it when the reminder actually reached the user on some channel —
        // otherwise a transient failure silently loses the reminder forever.
        if (!wasDelivered({ inAppOk: !notifErr, emailAttempted, emailOk })) {
          continue;
        }

        await supabase
          .from("general_applications")
          .update({ resume_reminder_sent_at: new Date().toISOString() })
          .eq("id", d.id);

        reminded++;
      }

      return new Response(JSON.stringify({ reminded, candidates: rows.length }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("resume-application-reminder error:", err);
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  })
);
