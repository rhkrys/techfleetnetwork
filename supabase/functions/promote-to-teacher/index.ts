// @edge-public
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@4.3.6";

import { withAuditWrapper } from "../_shared/audit.ts";

// M-01: Lenient shape guard. Existing UUID regex below stays authoritative.
const BodySchema = z.object({ user_id: z.string().optional() }).passthrough();
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Confirmation link points at the SPA page (sign-in + POST to confirm), not the
// edge function GET — T-G fix so an email prefetch can't auto-confirm.
const ALLOWED_APP_ORIGINS = new Set([
  "https://techfleetnetwork.lovable.app",
  "https://www.techfleet.network",
  "https://techfleet.network",
]);
function getSafeAppOrigin(): string {
  const configured = Deno.env.get("APP_ORIGIN") || "https://techfleetnetwork.lovable.app";
  try {
    const parsed = new URL(configured);
    if (ALLOWED_APP_ORIGINS.has(parsed.origin)) return parsed.origin;
  } catch {
    /* invalid URL */
  }
  return "https://techfleetnetwork.lovable.app";
}

Deno.serve(
  withAuditWrapper("promote-to-teacher", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const {
        data: { user: callingUser },
        error: authErr,
      } = await userClient.auth.getUser();
      if (authErr || !callingUser) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const adminClient = createClient(supabaseUrl, serviceRoleKey);

      const { data: callerRole } = await adminClient
        .from("user_roles")
        .select("id")
        .eq("user_id", callingUser.id)
        .eq("role", "admin")
        .maybeSingle();
      if (!callerRole) {
        return new Response(JSON.stringify({ error: "Forbidden: admin role required" }), {
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
      const targetUserId = body?.user_id;
      if (
        !targetUserId ||
        typeof targetUserId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(targetUserId)
      ) {
        return new Response(JSON.stringify({ error: "user_id is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (targetUserId === callingUser.id) {
        return new Response(JSON.stringify({ error: "Cannot promote yourself" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: existingRole } = await adminClient
        .from("user_roles")
        .select("id")
        .eq("user_id", targetUserId)
        .eq("role", "teacher")
        .maybeSingle();
      if (existingRole) {
        return new Response(JSON.stringify({ error: "User is already a teacher" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: targetProfile } = await adminClient
        .from("profiles")
        .select("email, first_name, display_name")
        .eq("user_id", targetUserId)
        .maybeSingle();
      if (!targetProfile?.email) {
        return new Response(JSON.stringify({ error: "Target user profile not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: promotion, error: promoErr } = await adminClient
        .from("teacher_promotions")
        .insert({ user_id: targetUserId, promoted_by: callingUser.id })
        .select("token")
        .single();
      if (promoErr || !promotion) {
        console.error("Failed to create teacher promotion:", promoErr);
        return new Response(JSON.stringify({ error: "Failed to create promotion" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const confirmUrl = `${getSafeAppOrigin()}/confirm-teacher?token=${promotion.token}`;
      const userName = targetProfile.first_name || targetProfile.display_name || "there";
      const normalizedEmail = targetProfile.email.trim().toLowerCase();
      const messageId = `teacher-promo-${targetUserId}-${crypto.randomUUID()}`;
      const unsubscribeToken = crypto.randomUUID();

      const emailPayload: Record<string, unknown> = {
        to: normalizedEmail,
        subject: "Tech Fleet: Confirm Your Teacher Role",
        from: "Tech Fleet <onboarding@techfleet.org>",
        sender_domain: "notify.techfleet.org",
        label: "teacher_promotion",
        message_id: messageId,
        idempotency_key: messageId,
        unsubscribe_token: unsubscribeToken,
        queued_at: new Date().toISOString(),
        purpose: "transactional",
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background-color:#f4f4f5;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">
  <div style="background:#fff;border-radius:8px;padding:32px;border:1px solid #e4e4e7;">
    <h1 style="font-size:14px;font-weight:600;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 24px 0;text-align:center;">Tech Fleet Network</h1>
    <h2 style="font-size:22px;font-weight:700;color:#18181b;margin:0 0 16px 0;">You've been invited to teach</h2>
    <p style="font-size:15px;line-height:1.6;color:#3f3f46;">Hi ${userName},</p>
    <p style="font-size:15px;line-height:1.6;color:#3f3f46;">A Tech Fleet admin has granted you the <strong>Teacher</strong> role. Teachers can author Basic Training and Advanced Training classes and publish cohorts (with admin approval).</p>
    <div style="text-align:center;margin:30px 0;">
      <a href="${confirmUrl}" style="background-color:hsl(221,83%,53%);color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Confirm Teacher Role</a>
    </div>
    <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
    <p style="font-size:12px;color:#a1a1aa;text-align:center;margin:0;">If you did not expect this, you can safely ignore this email.</p>
  </div>
</div></body></html>`,
        text: [
          "Tech Fleet Network",
          "",
          `Hi ${userName},`,
          `You've been granted the Teacher role on Tech Fleet Network.`,
          `Confirm here: ${confirmUrl}`,
        ].join("\n"),
      };

      await adminClient
        .from("email_unsubscribe_tokens")
        .insert({ email: normalizedEmail, token: unsubscribeToken });
      await adminClient.from("email_send_log").insert({
        message_id: messageId,
        recipient_email: normalizedEmail,
        template_name: "teacher_promotion",
        status: "pending",
        metadata: { confirm_url: confirmUrl },
      });

      try {
        await adminClient.rpc("enqueue_email", {
          queue_name: "transactional_emails",
          payload: emailPayload,
        });
      } catch (e) {
        console.error("Failed to enqueue email:", e);
      }

      await adminClient.rpc("write_audit_log", {
        p_event_type: "teacher_promotion_initiated",
        p_table_name: "teacher_promotions",
        p_record_id: targetUserId,
        p_user_id: callingUser.id,
        p_changed_fields: ["role:teacher", `target:${targetProfile.email}`],
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: `Confirmation email sent to ${targetProfile.email}`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error("Unexpected error:", err);
      return new Response(JSON.stringify({ error: "An unexpected error occurred" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  })
);
