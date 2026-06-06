// @edge-cron
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@4.3.6";
import { createEdgeLogger } from "../_shared/logger.ts";

// M-01: Lenient shape guard. Existing field checks (action / project_id / client_name) below stay authoritative.
const PayloadSchema = z.object({
  action: z.string().optional(),
  project_id: z.string().optional(),
  client_name: z.string().optional(),
  project_type: z.string().optional(),
  project_status: z.string().optional(),
  phase: z.string().optional(),
  team_hats: z.array(z.string()).optional(),
  timezone_range: z.string().optional(),
  anticipated_start_date: z.string().nullable().optional(),
  anticipated_end_date: z.string().nullable().optional(),
  current_phase_milestones: z.array(z.string()).optional(),
  changes: z.array(z.string()).optional(),
}).passthrough();

import { withAuditWrapper } from "../_shared/audit.ts";
const log = createEdgeLogger("discord-project-update");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STATUS_LABELS: Record<string, string> = {
  coming_soon: "Coming Soon",
  apply_now: "Accepting Applications",
  recruiting: "Recruiting",
  team_onboarding: "Team Onboarding",
  project_in_progress: "Project In Progress",
  project_complete: "Project Complete",
};

const TYPE_LABELS: Record<string, string> = {
  website_design: "Website Design",
  service_design: "Service Design",
  application_design: "Application Design",
  strategy: "Strategy",
  discovery: "Discovery",
};

const PHASE_LABELS: Record<string, string> = {
  phase_1: "Phase 1",
  phase_2: "Phase 2",
  phase_3: "Phase 3",
  phase_4: "Phase 4",
};

interface ProjectUpdatePayload {
  action: "created" | "updated";
  project_id: string;
  client_name: string;
  project_type: string;
  project_status: string;
  phase: string;
  team_hats: string[];
  timezone_range?: string;
  anticipated_start_date?: string | null;
  anticipated_end_date?: string | null;
  current_phase_milestones?: string[];
  /** Only present on updates — lists what changed */
  changes?: string[];
}

const VALID_ACTIONS = new Set(["created", "updated"]);

/** Max request body size (8 KB) */
const MAX_BODY_BYTES = 8 * 1024;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(withAuditWrapper("discord-project-update", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID().substring(0, 8);
  log.info("handler", `Request received [${requestId}]`, { requestId });

  try {
    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    // Enforce body size
    const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
    if (contentLength > MAX_BODY_BYTES) {
      return jsonResponse({ error: "Request body too large" }, 413);
    }

    const rawPayload = await req.json();
    const parsedPayload = PayloadSchema.safeParse(rawPayload);
    if (!parsedPayload.success) {
      return jsonResponse({ error: "Invalid payload" }, 400);
    }
    const payload = parsedPayload.data as ProjectUpdatePayload;

    if (!payload?.action || !VALID_ACTIONS.has(payload.action)) {
      return jsonResponse({ error: "Invalid action" }, 400);
    }
    if (!payload.project_id || !payload.client_name) {
      return jsonResponse({ error: "Missing required fields" }, 400);
    }

    const webhookUrl = Deno.env.get("DISCORD_PROJECT_UPDATES_WEBHOOK");
    if (!webhookUrl) {
      log.warn("handler", "DISCORD_PROJECT_UPDATES_WEBHOOK not configured", { requestId });
      return jsonResponse({ success: false, skipped: true, reason: "webhook_not_configured" });
    }

    // Build Discord message
    const statusLabel = STATUS_LABELS[payload.project_status] || payload.project_status;
    const typeLabel = TYPE_LABELS[payload.project_type] || payload.project_type;
    const phaseLabel = PHASE_LABELS[payload.phase] || payload.phase;

    const projectUrl = `https://techfleetnetwork.lovable.app/project-openings/${payload.project_id}`;

    let content: string;

    if (payload.action === "created") {
      content = [
        `<@&1083439364975112293>`,
        "",
        `🆕 **New Project Created**`,
        "",
        `**Client:** ${payload.client_name}`,
        `**Type:** ${typeLabel}`,
        `**Phase:** ${phaseLabel}`,
        `**Status:** ${statusLabel}`,
        payload.team_hats.length > 0 ? `**Team Roles:** ${payload.team_hats.join(", ")}` : "",
        payload.anticipated_start_date ? `**Start Date:** ${payload.anticipated_start_date}` : "",
        payload.anticipated_end_date ? `**End Date:** ${payload.anticipated_end_date}` : "",
        payload.current_phase_milestones && payload.current_phase_milestones.length > 0
          ? `**Milestones:** ${payload.current_phase_milestones.join(", ")}`
          : "",
        "",
        statusLabel === "Accepting Applications"
          ? `🔗 [Apply Now](${projectUrl})`
          : `🔗 [View Project](${projectUrl})`,
      ].filter(Boolean).join("\n");
    } else {
      // Updated
      const changeList = payload.changes && payload.changes.length > 0
        ? payload.changes.map((c) => `• ${c}`).join("\n")
        : "• General updates";

      content = [
        `<@&1083439364975112293>`,
        "",
        `📝 **Project Updated — ${payload.client_name}**`,
        "",
        `**What changed:**`,
        changeList,
        "",
        `**Current Status:** ${statusLabel}`,
        `**Phase:** ${phaseLabel}`,
        `**Type:** ${typeLabel}`,
        "",
        `🔗 [View Project](${projectUrl})`,
      ].join("\n");
    }

    log.info("handler", `Posting ${payload.action} for project ${payload.project_id} [${requestId}]`, {
      requestId,
      action: payload.action,
      projectId: payload.project_id,
      clientName: payload.client_name,
    });

    try {
      const discordRes = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          allowed_mentions: { roles: ["1083439364975112293"] },
        }),
      });

      if (!discordRes.ok) {
        const errText = await discordRes.text();
        log.warn("handler", `Discord webhook failed [${requestId}]: ${discordRes.status}`, {
          requestId,
          status: discordRes.status,
          body: errText.substring(0, 300),
        });
        return jsonResponse({ success: false, skipped: true, reason: "discord_api_error" });
      }

      await discordRes.text();
      log.info("handler", `Discord project update posted [${requestId}]`, { requestId });
      return jsonResponse({ success: true });
    } catch (err) {
      log.warn("handler", `Discord request failed [${requestId}]`, { requestId }, err);
      return jsonResponse({ success: false, skipped: true, reason: "discord_request_failed" });
    }
  } catch (err) {
    log.error("handler", `Unhandled exception [${requestId}]`, { requestId }, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
}));
