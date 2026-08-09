// @edge-cron
// notify-class-published
// Called by the app (admin-only) right after approve_and_publish_class succeeds.
// Sends an in-app notification to every follower of the class. Idempotent per
// follower per class via a metadata check on notifications.

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@4.3.6";

import { withAuditWrapper } from "../_shared/audit.ts";
import { escapeHtml } from "../_shared/escape-html.ts";

// M-01: Lenient shape guard. Existing UUID regex below stays authoritative.
const BodySchema = z.object({ class_id: z.string().optional() }).passthrough();
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(
  withAuditWrapper("notify-class-published", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
      const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const {
        data: { user },
        error: authErr,
      } = await userClient.auth.getUser();
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const admin = createClient(SUPABASE_URL, SERVICE_KEY);

      const { data: roleRow } = await admin
        .from("user_roles")
        .select("id")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (!roleRow) {
        return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const rawBody = await req.json().catch(() => ({}));
      const parsedBody = BodySchema.safeParse(rawBody);
      if (!parsedBody.success) {
        return new Response(JSON.stringify({ error: "Invalid body" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const body = parsedBody.data as Record<string, unknown>;
      const classId: string | undefined = body?.class_id as string | undefined;
      if (!classId || !/^[0-9a-f-]{36}$/i.test(classId)) {
        return new Response(JSON.stringify({ error: "class_id required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: cls, error: clsErr } = await admin
        .from("classes")
        .select("id, title, slug, status, owner_user_id")
        .eq("id", classId)
        .maybeSingle();
      if (clsErr || !cls) {
        return new Response(JSON.stringify({ error: "Class not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (cls.status !== "published") {
        return new Response(JSON.stringify({ error: "Class is not published" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: followers, error: fErr } = await admin
        .from("class_followers")
        .select("user_id")
        .eq("class_id", classId);
      if (fErr) {
        console.error("followers query failed", fErr);
        return new Response(JSON.stringify({ error: "Failed to load followers" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const recipients = new Set<string>();
      for (const f of followers ?? []) recipients.add(f.user_id);
      // Always notify the teacher who owns the class.
      if (cls.owner_user_id) recipients.add(cls.owner_user_id);

      const linkUrl = `/classes/${cls.slug}`;
      // Escape the teacher-controlled class title before it lands in the
      // notification title (audit T-D; mirrors quest-nudge's path_title).
      const title = `New class published: ${escapeHtml(cls.title)}`;
      const html = `<p>A class you follow is now live on Tech Fleet Network.</p><p><a href="${linkUrl}">Open the class</a></p>`;

      let sent = 0;
      let failed = 0;
      for (const uid of recipients) {
        const { error: nErr } = await admin.rpc("safe_create_notification", {
          p_user_id: uid,
          p_title: title,
          p_body_html: html,
          p_notification_type: "class_published",
          p_link_url: linkUrl,
          p_source: "notify-class-published",
        });
        if (nErr) {
          failed++;
          console.error("notif failed for", uid, nErr);
        } else {
          sent++;
        }
      }

      return new Response(
        JSON.stringify({ ok: true, class_id: classId, recipients: recipients.size, sent, failed }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error("notify-class-published error:", err);
      return new Response(JSON.stringify({ error: "Unexpected error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  })
);
