// @edge-cron
/**
 * send-community-agreement-trigger
 *
 * Admin-only edge function that asks an active teammate to sign the
 * Community Contributor Terms. Sends an in-app notification and the Tier-0
 * agreement email (always sent; no member preference gate).
 *
 * Used in two contexts:
 *  1. notify-applicant-status calls this internally when status flips to
 *     active_participant (service-role internal call path).
 *  2. Admin clicks "Resend agreement" in Recruiting Center (JWT path).
 *
 * Security: JWT verification + has_role(admin) check OR service-role secret.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { queueTransactionalEmail } from "../_shared/transactional-email.ts";
import { withAuditWrapper } from "../_shared/audit.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret",
} as const;
const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" } as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APP_BASE_URL = "https://techfleet.network";

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
function err(message: string, status: number): Response {
  return json({ error: message }, status);
}
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

Deno.serve(
  withAuditWrapper("send-community-agreement-trigger", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
    if (req.method !== "POST") return err("Method not allowed", 405);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return err("Server misconfiguration", 500);
    const supabase = createClient(supabaseUrl, serviceKey);

    // Auth: admin JWT OR internal service-role secret bypass.
    const internalSecret = Deno.env.get("INTERNAL_FN_SECRET") || serviceKey;
    const incomingInternal = req.headers.get("x-internal-secret");
    let isInternalCall = false;
    if (incomingInternal && incomingInternal === internalSecret) {
      isInternalCall = true;
    } else {
      const authHeader = req.headers.get("authorization");
      if (!authHeader?.startsWith("Bearer ")) return err("Unauthorized", 401);
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser(authHeader.slice(7));
      if (authError || !user) return err("Unauthorized", 401);
      const { data: isAdmin } = await supabase.rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      });
      if (!isAdmin) return err("Forbidden", 403);
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return err("Invalid JSON", 400);
    }
    const applicationId = body?.application_id;
    if (typeof applicationId !== "string" || !UUID_RE.test(applicationId)) {
      return err("Invalid application_id", 400);
    }

    // Load application + project + client + applicant profile
    const { data: app, error: appErr } = await supabase
      .from("project_applications")
      .select(
        "id, user_id, project_id, applicant_status, community_agreement_required_at, community_agreement_signed_at, team_hats_interest"
      )
      .eq("id", applicationId)
      .maybeSingle();
    if (appErr || !app) return err("Application not found", 404);
    if (app.applicant_status !== "active_participant") {
      return err("Application is not active_participant", 409);
    }
    if (app.community_agreement_signed_at) {
      return err("Agreement already signed", 409);
    }

    // Ensure required_at is set
    if (!app.community_agreement_required_at) {
      await supabase.rpc("mark_community_agreement_required", { p_application_id: applicationId });
    }

    // Load project + client name
    let projectName = "";
    let clientName = "";
    try {
      const { data: proj } = await supabase
        .from("projects")
        .select("friendly_name, clients:client_id ( name )")
        .eq("id", app.project_id)
        .maybeSingle();
      const c: any = (proj as any)?.clients;
      clientName = (c && !Array.isArray(c) ? c.name : Array.isArray(c) ? c[0]?.name : "") || "";
      projectName = (proj as any)?.friendly_name || clientName || "Tech Fleet project";
    } catch (_) {
      /* non-critical */
    }

    // Load applicant profile
    let firstName = "";
    let email = "";
    try {
      const { data: prof } = await supabase
        .from("profiles")
        .select("first_name, email")
        .eq("user_id", app.user_id)
        .maybeSingle();
      firstName = (prof?.first_name as string) || "";
      email = (prof?.email as string) || "";
    } catch (_) {
      /* non-critical */
    }

    const agreementLink = `${APP_BASE_URL}/applications/projects/${applicationId}/status?agreement=open`;
    const projectLabel = projectName || "your Tech Fleet project";
    const clientLabel = clientName || "a nonprofit client";

    const hats: string[] = Array.isArray((app as any).team_hats_interest)
      ? ((app as any).team_hats_interest as string[]).filter(
          (h) => typeof h === "string" && h.trim().length > 0
        )
      : [];
    const hatsListHtml =
      hats.length > 0
        ? `<ul>${hats.map((h) => `<li>${escapeHtml(h)}</li>`).join("")}</ul>`
        : "<p><em>The hats you selected when you applied.</em></p>";

    // 1. Always create in-app notification (workflow-critical)
    let notificationCreated = false;
    try {
      const bodyHtml =
        `<p>Hello ${escapeHtml(firstName || "there")}!</p>` +
        `<p>Thank you so much for taking the time to chat with the project coordinator. It was so wonderful getting to know you.</p>` +
        `<p><strong>Training Offer</strong></p>` +
        `<p>I am delighted to offer you a training position for the upcoming apprenticeship!</p>` +
        `<p><strong>${escapeHtml(projectLabel)}</strong> – Cross-Functional Agile Teammate</p>` +
        `<p><strong>Hats</strong></p>` +
        hatsListHtml +
        `<p><strong>Reply Now</strong></p>` +
        `<p>If you want to commit to this training, click the button below to sign the Community Trainee Terms and Conditions so that you know what to expect about the training.</p>` +
        `<p><strong>Next steps</strong></p>` +
        `<ol>` +
        `<li>Sign the Community Trainee Terms and Conditions.</li>` +
        `<li>We can get you into the project channels in Discord.</li>` +
        `<li>We will have a full teammate kickoff after we build the entire training team, so look out for communications in email and Discord to schedule.</li>` +
        `<li>After that we will all start working with an Agile Coach to do “pre-kickoff” for the first 3 weeks of the project.</li>` +
        `<li>After pre-kickoff, we will start our 8 weeks of project training work together.</li>` +
        `</ol>` +
        `<p>Looking forward to hearing from you soon!</p>`;
      const { error: nErr } = await supabase.rpc("safe_create_notification", {
        p_user_id: app.user_id,
        p_title: "Project Training Offer from Tech Fleet",
        p_body_html: bodyHtml,
        p_notification_type: "community_agreement_request",
        p_link_url: `/applications/projects/${applicationId}/status?agreement=open`,
        p_source: "send-community-agreement-trigger",
      });
      if (!nErr) notificationCreated = true;
      else console.error("Notification enqueue failed", nErr.message);
    } catch (e) {
      console.error("Notification error", e);
    }

    // 2. Email — community-agreement-request is Tier 0 (offer of an earned place): always send.
    let emailSent = false;
    let emailSkippedReason: string | null = null;
    if (!email) emailSkippedReason = "no_email";
    else {
      const idempotencyKey = `community-agreement-${applicationId}-${app.community_agreement_required_at || new Date().toISOString().slice(0, 10)}`;
      try {
        const result = await queueTransactionalEmail({
          supabase,
          templateName: "community-agreement-request",
          recipientEmail: email,
          idempotencyKey,
          messageId: idempotencyKey,
          templateData: {
            firstName: firstName || undefined,
            projectName: projectLabel,
            clientName: clientLabel,
            agreementUrl: agreementLink,
            hats,
          },
        });
        if (result.ok) emailSent = !result.suppressed;
        else console.error("Email queue failed", result.error);
      } catch (e) {
        console.error("Email error", e);
      }
    }

    // 3. Audit log
    try {
      await supabase.rpc("write_audit_log", {
        p_event_type: "community_agreement_trigger_sent",
        p_table_name: "project_applications",
        p_record_id: applicationId,
        p_user_id: null,
        p_changed_fields: [app.user_id, isInternalCall ? "internal" : "admin_manual"],
      });
    } catch (_) {
      /* non-critical */
    }

    return json({
      success: true,
      notificationCreated,
      emailSent,
      emailSkippedReason,
    });
  })
);
