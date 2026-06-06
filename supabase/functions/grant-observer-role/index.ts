// @edge-cron
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { z } from "npm:zod@4.3.6";
import { createEdgeLogger } from "../_shared/logger.ts";
import { discordFetch } from "../_shared/discord-fetch.ts";

// M-01: Lenient shape guard. Existing confirm:true check below stays authoritative.
const BodySchema = z.object({ confirm: z.unknown().optional() }).passthrough();

import { withAuditWrapper } from "../_shared/audit.ts";
const log = createEdgeLogger("grant-observer-role");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_BODY_BYTES = 1024;

// All Observer course lesson IDs that must be completed before granting roles.
const REQUIRED_LESSON_IDS = [
  "obs-1", "obs-2", "obs-3", "obs-4", "obs-5", "obs-6", "obs-7",
];

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function audit(
  admin: ReturnType<typeof createClient>,
  userId: string,
  eventType: string,
  errorMessage?: string,
) {
  try {
    await admin.rpc("write_audit_log", {
      p_event_type: eventType,
      p_table_name: "observer_role_optins",
      p_record_id: userId,
      p_user_id: userId,
      p_error_message: errorMessage ?? null,
    });
  } catch { /* swallow */ }
}

serve(withAuditWrapper("grant-observer-role", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const requestId = crypto.randomUUID().substring(0, 8);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Body validation
  const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_BODY_BYTES) return json({ error: "Body too large" }, 413);
  let body: unknown;
  try {
    const raw = await req.json();
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) return json({ error: "Invalid body" }, 400);
    body = parsed.data;
  } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body || typeof body !== "object" || (body as Record<string, unknown>).confirm !== true) {
    return json({ error: "Missing confirm:true" }, 400);
  }

  // Inline rate limit: max 5 grant attempts (any outcome) per user per hour.
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("audit_log")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", user.id)
      .eq("table_name", "observer_role_optins")
      .gte("created_at", oneHourAgo);
    if ((count ?? 0) >= 5) {
      await audit(admin, user.id, "observer_role_grant_rate_limited");
      return json({ error: "Too many attempts. Please try again later." }, 429);
    }
  } catch (e) {
    log.warn("ratelimit", `rate-limit check failed [${requestId}]`, {}, e as Error);
  }

  const PROJECTS_ROLE_ID = Deno.env.get("DISCORD_PROJECTS_ROLE_ID");
  const OBSERVERS_ROLE_ID = Deno.env.get("DISCORD_OBSERVERS_ROLE_ID");
  const BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN");
  const GUILD_ID = Deno.env.get("DISCORD_GUILD_ID");

  if (!PROJECTS_ROLE_ID || !OBSERVERS_ROLE_ID || !BOT_TOKEN || !GUILD_ID) {
    log.error("config", `Discord/role env missing [${requestId}]`);
    await audit(admin, user.id, "observer_role_grant_failed", "Server misconfigured");
    return json({ error: "Server misconfigured" }, 500);
  }

  // Verify all Observer lessons are complete
  const { data: progress, error: progErr } = await admin
    .from("journey_progress")
    .select("task_id, completed")
    .eq("user_id", user.id)
    .eq("phase", "observer")
    .in("task_id", REQUIRED_LESSON_IDS);

  if (progErr) {
    await audit(admin, user.id, "observer_role_grant_failed", `progress query: ${progErr.message}`);
    return json({ error: "Could not verify course progress" }, 500);
  }

  const completedIds = new Set((progress ?? []).filter((r) => r.completed).map((r) => r.task_id));
  const missing = REQUIRED_LESSON_IDS.filter((id) => !completedIds.has(id));
  if (missing.length > 0) {
    await audit(admin, user.id, "observer_role_grant_failed", `incomplete lessons: ${missing.join(",")}`);
    return json({ error: "Complete all Observer lessons first", missing }, 403);
  }

  // Verify Discord linked
  const { data: profile } = await admin
    .from("profiles")
    .select("discord_user_id, has_discord_account")
    .eq("user_id", user.id)
    .single();

  const discordUserId = profile?.discord_user_id?.trim();
  if (!discordUserId || !profile?.has_discord_account) {
    return json({ error: "discord_not_linked" }, 409);
  }

  // Idempotency check
  const { data: existing } = await admin
    .from("observer_role_optins")
    .select("projects_role_granted_at, observers_role_granted_at, opted_in_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (
    existing?.projects_role_granted_at &&
    existing?.observers_role_granted_at
  ) {
    return json({
      ok: true,
      alreadyGranted: true,
      projects_role_granted_at: existing.projects_role_granted_at,
      observers_role_granted_at: existing.observers_role_granted_at,
    }, 200);
  }

  // Ensure opt-in row exists
  await admin.from("observer_role_optins").upsert(
    {
      user_id: user.id,
      discord_user_id: discordUserId,
      opted_in_at: existing ? undefined : new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  const discordHeaders = { Authorization: `Bot ${BOT_TOKEN}` };

  async function grantRole(roleId: string): Promise<{ ok: boolean; error?: string; status?: number }> {
    try {
      const { response } = await discordFetch(
        `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${discordUserId}/roles/${roleId}`,
        { method: "PUT", headers: discordHeaders },
      );
      if (!response.ok) {
        const text = await response.text();
        return { ok: false, error: text.substring(0, 300), status: response.status };
      }
      await response.text();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message?.substring(0, 300) };
    }
  }

  const results = {
    projects_granted: !!existing?.projects_role_granted_at,
    observers_granted: !!existing?.observers_role_granted_at,
    queued_for_retry: false as boolean,
    error: null as string | null,
  };

  // Step 1: Projects role (prerequisite)
  if (!results.projects_granted) {
    const r = await grantRole(PROJECTS_ROLE_ID);
    if (r.ok) {
      results.projects_granted = true;
      await admin.from("observer_role_optins")
        .update({ projects_role_granted_at: new Date().toISOString(), last_error: null })
        .eq("user_id", user.id);
    } else {
      results.queued_for_retry = true;
      results.error = `Projects role: ${r.error}`;
      if (r.status !== 404) {
        await admin.rpc("queue_discord_role_grant", {
          p_user_id: user.id,
          p_discord_user_id: discordUserId,
          p_role_id: PROJECTS_ROLE_ID,
          p_reason: "grant-observer-role",
          p_error: r.error ?? null,
        });
      }
      await admin.from("observer_role_optins")
        .update({ last_error: results.error })
        .eq("user_id", user.id);
    }
  }

  // Step 2: Observers role
  if (results.projects_granted && !results.observers_granted) {
    const r = await grantRole(OBSERVERS_ROLE_ID);
    if (r.ok) {
      results.observers_granted = true;
      await admin.from("observer_role_optins")
        .update({ observers_role_granted_at: new Date().toISOString(), last_error: null })
        .eq("user_id", user.id);
    } else {
      results.queued_for_retry = true;
      results.error = `Observers role: ${r.error}`;
      if (r.status !== 404) {
        await admin.rpc("queue_discord_role_grant", {
          p_user_id: user.id,
          p_discord_user_id: discordUserId,
          p_role_id: OBSERVERS_ROLE_ID,
          p_reason: "grant-observer-role",
          p_error: r.error ?? null,
        });
      }
      await admin.from("observer_role_optins")
        .update({ last_error: results.error })
        .eq("user_id", user.id);
    }
  }

  if (results.projects_granted && results.observers_granted) {
    await audit(admin, user.id, "observer_role_granted");

    // Best-effort: in-app notification + transactional email, both gated on user preferences.
    try {
      const { data: prof } = await admin
        .from("profiles")
        .select("first_name, email, notify_announcements")
        .eq("user_id", user.id)
        .maybeSingle();

      const wantsEmail = prof?.notify_announcements !== false; // default true
      const firstName = (prof?.first_name as string | undefined) || undefined;

      if (wantsEmail) {
        // In-app notification (notification_preferences toggle = notify_announcements)
        await admin.from("notifications").insert({
          user_id: user.id,
          notification_type: "observer_role_granted",
          title: "You're an Observer! 🎉",
          body_html:
            "Your <strong>Projects</strong> and <strong>Observers</strong> Discord roles are active. " +
            "Pick a project meeting on the <a href=\"/events\">Events Calendar</a> and explore project channels in Discord.",
          link_url: "/events",
        });

        // Transactional email
        await admin.functions.invoke("send-transactional-email", {
          body: {
            templateName: "observer-role-granted",
            recipientEmail: prof?.email ?? user.email,
            idempotencyKey: `observer-role-granted-${user.id}`,
            templateData: { firstName },
          },
        });
      }
    } catch (e) {
      log.warn("postGrantNotify", `notify/email failed [${requestId}]`, {}, e as Error);
    }

    return json({
      ok: true,
      projects_granted: true,
      observers_granted: true,
    }, 200);
  }

  await audit(admin, user.id, "observer_role_grant_failed", results.error ?? "unknown");
  return json({
    ok: false,
    queued_for_retry: results.queued_for_retry,
    projects_granted: results.projects_granted,
    observers_granted: results.observers_granted,
    error: results.error ?? "Failed to grant one or more roles",
  }, 502);
}));
